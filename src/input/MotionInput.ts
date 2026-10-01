import { CameraError, CameraManager } from "../camera/CameraManager";
import type { CameraConfig, MovementConfig, PoseConfig } from "../config/gameConfig";
import { MovementDetector } from "../movement/MovementDetector";
import type { MovementEvent, MovementSnapshot } from "../movement/MovementTypes";
import { PoseEstimator } from "../pose/PoseEstimator";
import type { Point2D, PoseFrame } from "../pose/PoseTypes";
import { getBodyCenter } from "../pose/PoseUtils";
import { Emitter } from "../utils/Emitter";
import { FpsCounter } from "../utils/FpsCounter";

export type MotionStatus = "idle" | "starting-camera" | "loading-model" | "ready" | "error";

interface MotionInputEvents extends Record<string, unknown> {
  movement: MovementEvent;
  status: MotionStatus;
}

export interface MotionInputConfig {
  camera: CameraConfig;
  pose: PoseConfig;
  movement: MovementConfig;
  fpsSampleWindowMs: number;
}

const DEFAULT_ASPECT_RATIO = 16 / 9;

/**
 * Webcam → pose → movement pipeline behind a single object. Owns the camera,
 * the pose estimator and the movement detector, and runs inference in its own
 * throttled loop, decoupled from game rendering. Consumers get semantic
 * `movement` events and read-only state for debug displays; raw video never
 * leaves this class' video element.
 */
export class MotionInput extends Emitter<MotionInputEvents> {
  private detector: MovementDetector;
  private readonly camera: CameraManager;
  private readonly estimator: PoseEstimator;
  private readonly inferenceFps: FpsCounter;
  private readonly inferenceIntervalMs: number;
  private readonly bodyCenterScratch: Point2D = { x: 0, y: 0 };

  private _status: MotionStatus = "idle";
  private _error: string | null = null;
  private _pose: PoseFrame | null = null;
  private _bodyCenter: Point2D | null = null;
  private _inferenceMs = 0;

  private running = false;
  private rafId = 0;
  private lastInferenceAt = Number.NEGATIVE_INFINITY;
  private lastVideoTime = -1;

  constructor(
    private readonly video: HTMLVideoElement,
    private config: MotionInputConfig,
  ) {
    super();
    this.camera = new CameraManager(video, config.camera);
    this.estimator = new PoseEstimator(config.pose, config.camera.mirror);
    this.detector = new MovementDetector(config.movement, config.pose.minLandmarkVisibility, DEFAULT_ASPECT_RATIO);
    this.inferenceFps = new FpsCounter(config.fpsSampleWindowMs);
    this.inferenceIntervalMs = 1000 / config.pose.targetInferenceFps;
    this.attachDetector();
  }

  get movementDetector(): MovementDetector {
    return this.detector;
  }

  private attachDetector(): void {
    this.detector.on("movement", (event) => this.emit("movement", event));
  }

  /**
   * Swap in new movement thresholds (e.g. after calibration). The detector starts fresh,
   * so it re-learns the standing baseline for a moment.
   */
  reconfigure(movement: MovementConfig): void {
    const aspect = this.camera.height > 0 ? this.camera.width / this.camera.height : DEFAULT_ASPECT_RATIO;
    this.config = { ...this.config, movement };
    this.detector = new MovementDetector(movement, this.config.pose.minLandmarkVisibility, aspect);
    this.attachDetector();
  }

  get status(): MotionStatus {
    return this._status;
  }

  get error(): string | null {
    return this._error;
  }

  /** Latest pose frame (shared object, mutated in place). */
  get pose(): PoseFrame | null {
    return this._pose;
  }

  get bodyCenter(): Point2D | null {
    return this._bodyCenter;
  }

  get inferenceMs(): number {
    return this._inferenceMs;
  }

  get inferenceRate(): number {
    return this.inferenceFps.fps;
  }

  get videoWidth(): number {
    return this.camera.width;
  }

  get videoHeight(): number {
    return this.camera.height;
  }

  snapshot(): MovementSnapshot {
    return this.detector.snapshot();
  }

  /** Start camera and model, then begin the inference loop. Resolves true on success. */
  async start(): Promise<boolean> {
    if (this.running) return true;
    this._error = null;
    try {
      this.setStatus("starting-camera");
      await this.camera.start();
      if (this.camera.height > 0) this.detector.setAspectRatio(this.camera.width / this.camera.height);

      this.setStatus("loading-model");
      await this.estimator.init();
    } catch (err) {
      console.error(err);
      this.camera.stop();
      this._error = err instanceof CameraError ? err.message : `Gagal memulai: ${String(err)}`;
      this.setStatus("error");
      return false;
    }

    this.running = true;
    this.setStatus("ready");
    this.rafId = requestAnimationFrame(this.loop);
    return true;
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.estimator.dispose();
    this.camera.stop();
    this._pose = null;
    this._bodyCenter = null;
    this.detector.reset();
    this.setStatus("idle");
  }

  /**
   * Run one pose frame through movement detection. The inference loop calls
   * this; it is public so tests and debug tools can inject synthetic poses
   * without a camera.
   */
  processPose(pose: PoseFrame): void {
    this._pose = pose;
    this._bodyCenter = getBodyCenter(pose, this.config.pose.minLandmarkVisibility, this.bodyCenterScratch);
    this.detector.update(pose);
  }

  private readonly loop = (now: number): void => {
    if (!this.running) return;
    if (now - this.lastInferenceAt >= this.inferenceIntervalMs && this.video.currentTime !== this.lastVideoTime) {
      this.lastInferenceAt = now;
      this.lastVideoTime = this.video.currentTime;
      const t0 = performance.now();
      const pose = this.estimator.estimate(this.video, now);
      if (pose) {
        this._inferenceMs = performance.now() - t0;
        this.inferenceFps.tick(now);
        this.processPose(pose);
      }
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  private setStatus(status: MotionStatus): void {
    this._status = status;
    this.emit("status", status);
  }
}
