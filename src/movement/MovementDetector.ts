import type { MovementConfig } from "../config/gameConfig";
import type { PoseFrame } from "../pose/PoseTypes";
import { BodyBaseline } from "./BodyBaseline";
import { CrouchDetector } from "./CrouchDetector";
import { JumpDetector } from "./JumpDetector";
import { LaneDetector } from "./LaneDetector";
import type { MovementEvent, MovementSnapshot } from "./MovementTypes";
import { createPoseFeatures, extractPoseFeatures, type PoseFeatures } from "./PoseFeatures";
import { Emitter } from "../utils/Emitter";

interface MovementEvents extends Record<string, unknown> {
  movement: MovementEvent;
}

/**
 * Turns a stream of pose frames into semantic movement events
 * (LEFT/CENTER/RIGHT/JUMP/CROUCH). This is the only movement class the game
 * should consume; it owns the lane, jump and crouch detectors and the body
 * baseline, and emits events rather than touching game logic directly.
 */
export class MovementDetector extends Emitter<MovementEvents> {
  private readonly lane: LaneDetector;
  private readonly jump: JumpDetector;
  private readonly crouch: CrouchDetector;
  private readonly baseline: BodyBaseline;
  private readonly features: PoseFeatures = createPoseFeatures();

  private lastValidAt = Number.NEGATIVE_INFINITY;
  private displacement = 0;
  private lastEvent: MovementEvent | null = null;

  constructor(
    private readonly config: MovementConfig,
    private readonly minLandmarkVisibility: number,
    /** Camera width / height, used to keep knee-angle geometry undistorted. */
    private aspectRatio: number,
  ) {
    super();
    this.lane = new LaneDetector(config.lane);
    this.jump = new JumpDetector(config.jump);
    this.crouch = new CrouchDetector(config.crouch);
    this.baseline = new BodyBaseline(config.baseline);
  }

  setAspectRatio(aspectRatio: number): void {
    if (aspectRatio > 0) this.aspectRatio = aspectRatio;
  }

  update(pose: PoseFrame): void {
    const f = extractPoseFeatures(
      pose,
      this.minLandmarkVisibility,
      this.config.minPoseConfidence,
      this.aspectRatio,
      this.features,
    );
    const now = pose.timestamp;

    if (!f.valid) {
      if (now - this.lastValidAt >= this.config.trackingLostResetMs) this.resetDetectors();
      if (now - this.lastValidAt >= this.config.baseline.resetAfterLostMs) this.baseline.reset();
      return;
    }
    this.lastValidAt = now;

    // Lane does not need a baseline; report it as soon as the torso is visible.
    const laneChange = this.lane.update(now, f.centerX);
    if (laneChange) this.emitMovement(laneChange, f.confidence, now);

    // Vertical detection needs a standing reference first.
    const airborneOrLowering = this.jump.state === "AIRBORNE" || this.crouch.state !== "STANDING";
    this.baseline.update(f.hipY, f.torsoLength, !airborneOrLowering);
    if (!this.baseline.ready) {
      this.displacement = 0;
      return;
    }

    this.displacement = this.baseline.displacement(f.hipY);
    const hipDrop = -this.displacement;

    const jumpResult = this.jump.update(now, this.displacement, f.confidence);
    if (jumpResult) this.emitMovement("JUMP", jumpResult.confidence, now);

    // Suppress crouch while airborne so landing is not misread as a crouch.
    if (this.jump.state !== "AIRBORNE") {
      const crouchChange = this.crouch.update(now, { hipDrop, kneeAngleDeg: f.kneeAngleDeg }, f.confidence);
      if (crouchChange === "CROUCH_START") this.emitMovement("CROUCH", f.confidence, now);
    }
  }

  snapshot(): MovementSnapshot {
    const tracking = this.features.valid;
    return {
      tracking,
      baselineReady: this.baseline.ready,
      confidence: this.features.confidence,
      lane: this.lane.lane,
      centerX: this.lane.smoothedX,
      jumpState: this.jump.state,
      crouchState: this.crouch.state,
      displacement: this.displacement,
      kneeAngleDeg: this.features.kneeAngleDeg,
      baselineHipY: this.baseline.ready ? this.baseline.hipY : null,
      torsoLength: this.baseline.ready ? this.baseline.torsoLength : null,
      lastEvent: this.lastEvent,
    };
  }

  private emitMovement(movement: MovementEvent["movement"], confidence: number, timestamp: number): void {
    const event: MovementEvent = { movement, confidence, timestamp };
    this.lastEvent = event;
    this.emit("movement", event);
  }

  private resetDetectors(): void {
    this.lane.reset();
    this.jump.reset();
    this.crouch.reset();
  }

  reset(): void {
    this.resetDetectors();
    this.baseline.reset();
    this.lastValidAt = Number.NEGATIVE_INFINITY;
    this.displacement = 0;
    this.lastEvent = null;
  }
}
