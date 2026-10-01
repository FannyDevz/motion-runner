import type { CalibrationConfig, MovementConfig } from "../config/gameConfig";
import type { KeyValueStore } from "./Settings";

export type CalibrationStep = "STAND" | "LEFT" | "RIGHT" | "JUMP" | "CROUCH";

export const CALIBRATION_STEPS: readonly CalibrationStep[] = ["STAND", "LEFT", "RIGHT", "JUMP", "CROUCH"];

/** What the guided calibration measured. Optional steps are null when skipped. */
export interface CalibrationMeasurements {
  /** Body-center x while standing normally (image width, 0 = left). */
  standX: number;
  /** Standing hip height (image height, 0 = top). */
  hipY: number;
  /** Standing shoulder-to-hip length (image height). */
  torsoLength: number;
  leftX: number | null;
  rightX: number | null;
  /** Highest hip rise during a jump, in torso lengths. */
  jumpPeak: number | null;
  /** Deepest sustained hip drop while crouching, in torso lengths. */
  crouchDrop: number | null;
}

export interface CalibrationResult extends CalibrationMeasurements {
  version: 1;
  createdAt: number;
}

/** One frame of body measurements (see PoseFeatures); x is already mirrored. */
export interface CalibrationFrame {
  valid: boolean;
  timestamp: number;
  centerX: number;
  hipY: number;
  torsoLength: number;
}

export type StepStatus = "pending" | "active" | "done" | "skipped";

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * The guided calibration: stand, move left, move right, jump, crouch. Feed it body
 * measurements each frame; it advances by itself when a step is performed. Steps
 * other than STAND can be skipped. Pure logic with no camera or DOM, so it is testable.
 */
export class CalibrationSession {
  private index = 0;
  private readonly statuses: StepStatus[] = CALIBRATION_STEPS.map((_, i) => (i === 0 ? "active" : "pending"));
  private _progress = 0;
  private _hint = false;

  private stand: { x: number; y: number; torso: number } | null = null;
  private leftX: number | null = null;
  private rightX: number | null = null;
  private jumpPeak: number | null = null;
  private crouchDrop: number | null = null;

  // per-step working state
  private samples: CalibrationFrame[] = [];
  private windowStart: number | null = null;
  private holdStart: number | null = null;
  private holdValues: number[] = [];
  private lastValidAt: number | null = null;
  private airborneAt: number | null = null;
  private peak = 0;
  private xRange: [number, number] = [0, 0];
  private yRange: [number, number] = [0, 0];

  constructor(private readonly config: CalibrationConfig) {}

  /** The step being performed, or null when finished. */
  get step(): CalibrationStep | null {
    return this.index < CALIBRATION_STEPS.length ? CALIBRATION_STEPS[this.index] : null;
  }

  get done(): boolean {
    return this.step === null;
  }

  /** Progress of the current step, 0..1. */
  get progress(): number {
    return this.done ? 1 : this._progress;
  }

  /**
   * True while the player is moving the right way but has not gone far enough yet, so the
   * screen can say "a little further". Always false for STAND and once the step is done.
   */
  get needsMore(): boolean {
    return !this.done && this._hint;
  }

  statusOf(step: CalibrationStep): StepStatus {
    return this.statuses[CALIBRATION_STEPS.indexOf(step)];
  }

  /** The result once every step has been done or skipped; null before that. */
  result(now: number): CalibrationResult | null {
    if (!this.done || !this.stand) return null;
    return {
      version: 1,
      createdAt: now,
      standX: this.stand.x,
      hipY: this.stand.y,
      torsoLength: this.stand.torso,
      leftX: this.leftX,
      rightX: this.rightX,
      jumpPeak: this.jumpPeak,
      crouchDrop: this.crouchDrop,
    };
  }

  /** Skip the current step. STAND cannot be skipped: everything else is measured from it. */
  skip(): boolean {
    const step = this.step;
    if (step === null || step === "STAND") return false;
    this.finishStep("skipped");
    return true;
  }

  update(frame: CalibrationFrame): void {
    const step = this.step;
    if (step === null) return;

    if (!frame.valid) {
      this._hint = false;
      if (this.lastValidAt !== null && frame.timestamp - this.lastValidAt >= this.config.lostResetMs) this.resetStepWork();
      return;
    }
    // A long gap between valid frames also restarts the step.
    if (this.lastValidAt !== null && frame.timestamp - this.lastValidAt >= this.config.lostResetMs) this.resetStepWork();
    this.lastValidAt = frame.timestamp;

    switch (step) {
      case "STAND":
        this.updateStand(frame);
        break;
      case "LEFT":
        this.updateLane(frame, -1);
        break;
      case "RIGHT":
        this.updateLane(frame, 1);
        break;
      case "JUMP":
        this.updateJump(frame);
        break;
      case "CROUCH":
        this.updateCrouch(frame);
        break;
    }
  }

  // --- steps ----------------------------------------------------------------

  private updateStand(f: CalibrationFrame): void {
    const c = this.config;
    if (this.windowStart === null) this.startStandWindow(f);

    this.samples.push(f);
    this.xRange = [Math.min(this.xRange[0], f.centerX), Math.max(this.xRange[1], f.centerX)];
    this.yRange = [Math.min(this.yRange[0], f.hipY), Math.max(this.yRange[1], f.hipY)];

    const torso = f.torsoLength > 0 ? f.torsoLength : 1;
    const movedX = this.xRange[1] - this.xRange[0] > c.standToleranceX;
    const movedY = (this.yRange[1] - this.yRange[0]) / torso > c.standToleranceY;
    if (movedX || movedY) {
      // Still moving about: start the still-period again from this frame.
      this.startStandWindow(f);
      this.samples.push(f);
      this._progress = 0;
      return;
    }

    const elapsed = f.timestamp - (this.windowStart as number);
    this._progress = Math.min(1, elapsed / c.standDurationMs);
    if (elapsed >= c.standDurationMs && this.samples.length >= c.minStandSamples) {
      this.stand = {
        x: median(this.samples.map((s) => s.centerX)),
        y: median(this.samples.map((s) => s.hipY)),
        torso: median(this.samples.map((s) => s.torsoLength)),
      };
      this.finishStep("done");
    }
  }

  private startStandWindow(f: CalibrationFrame): void {
    this.windowStart = f.timestamp;
    this.samples = [];
    this.xRange = [f.centerX, f.centerX];
    this.yRange = [f.hipY, f.hipY];
  }

  /** LEFT (-1) / RIGHT (+1): hold a position shifted away from where the player stands. */
  private updateLane(f: CalibrationFrame, direction: -1 | 1): void {
    const stand = this.stand as { x: number };
    const shift = (f.centerX - stand.x) * direction;
    if (shift < this.config.laneShiftMin) {
      this.resetHold();
      this._progress = 0;
      this._hint = shift >= this.config.laneShiftMin * this.config.hintFraction;
      return;
    }
    this._hint = false;
    if (this.holdStart === null) this.holdStart = f.timestamp;
    this.holdValues.push(f.centerX);

    const held = f.timestamp - this.holdStart;
    this._progress = Math.min(1, held / this.config.holdMs);
    if (held >= this.config.holdMs) {
      const x = mean(this.holdValues);
      if (direction === -1) this.leftX = x;
      else this.rightX = x;
      this.finishStep("done");
    }
  }

  private updateJump(f: CalibrationFrame): void {
    const stand = this.stand as { y: number; torso: number };
    const rise = (stand.y - f.hipY) / stand.torso;

    if (this.airborneAt === null) {
      if (rise >= this.config.jumpMinPeak) {
        this.airborneAt = f.timestamp;
        this.peak = rise;
        this._progress = 0.5;
        this._hint = false;
      } else {
        this._hint = rise >= this.config.jumpMinPeak * this.config.hintFraction;
      }
      return;
    }
    this.peak = Math.max(this.peak, rise);
    if (rise < this.config.jumpLandedBelow) {
      this.jumpPeak = this.peak;
      this.finishStep("done");
    }
  }

  private updateCrouch(f: CalibrationFrame): void {
    const stand = this.stand as { y: number; torso: number };
    const drop = (f.hipY - stand.y) / stand.torso;
    if (drop < this.config.crouchMinDrop) {
      this.resetHold();
      this._progress = 0;
      this._hint = drop >= this.config.crouchMinDrop * this.config.hintFraction;
      return;
    }
    this._hint = false;
    if (this.holdStart === null) this.holdStart = f.timestamp;
    this.holdValues.push(drop);

    const held = f.timestamp - this.holdStart;
    this._progress = Math.min(1, held / this.config.holdMs);
    if (held >= this.config.holdMs) {
      this.crouchDrop = median(this.holdValues);
      this.finishStep("done");
    }
  }

  // --- bookkeeping ----------------------------------------------------------

  private finishStep(status: "done" | "skipped"): void {
    this.statuses[this.index] = status;
    this._hint = false;
    this.index++;
    if (this.index < CALIBRATION_STEPS.length) this.statuses[this.index] = "active";
    this._progress = 0;
    this.resetStepWork();
    this.lastValidAt = null;
  }

  private resetHold(): void {
    this.holdStart = null;
    this.holdValues = [];
  }

  private resetStepWork(): void {
    this.resetHold();
    this.windowStart = null;
    this.samples = [];
    this.airborneAt = null;
    this.peak = 0;
    this._progress = 0;
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The movement thresholds that suit this player. Lane boundaries sit between where
 * they stand and how far they moved, so the CENTER lane is wherever they naturally
 * stand. Jump and crouch thresholds are scaled to how high and how low they went.
 * Anything not measured keeps the default.
 */
export function deriveMovementConfig(base: MovementConfig, m: CalibrationMeasurements, c: CalibrationConfig): MovementConfig {
  let left: number;
  let right: number;
  if (m.leftX !== null && m.rightX !== null) {
    left = m.standX + (m.leftX - m.standX) * c.laneThresholdFraction;
    right = m.standX + (m.rightX - m.standX) * c.laneThresholdFraction;
  } else if (m.leftX !== null || m.rightX !== null) {
    // One side measured: assume the other side is as wide.
    const half = Math.abs(((m.leftX ?? m.rightX) as number) - m.standX) * c.laneThresholdFraction;
    left = m.standX - half;
    right = m.standX + half;
  } else {
    // Nothing measured: keep the default widths but centre them on where the player stands.
    const offset = m.standX - 0.5;
    left = base.lane.thresholds.left + offset;
    right = base.lane.thresholds.right + offset;
  }

  if (right - left < c.minLaneGap) {
    const mid = (left + right) / 2;
    left = mid - c.minLaneGap / 2;
    right = mid + c.minLaneGap / 2;
  }
  left = clamp(left, 0.05, 0.95 - c.minLaneGap);
  right = clamp(right, left + c.minLaneGap, 0.95);

  const jump = m.jumpPeak !== null ? clamp(m.jumpPeak * c.jumpThresholdFraction, c.jumpThresholdMin, c.jumpThresholdMax) : base.jump.minimumDisplacement;
  const crouchEnter = m.crouchDrop !== null ? clamp(m.crouchDrop * c.crouchEnterFraction, c.crouchEnterMin, c.crouchEnterMax) : base.crouch.enterDrop;
  const crouchExit = m.crouchDrop !== null ? crouchEnter * c.crouchExitFraction : base.crouch.exitDrop;

  return {
    ...base,
    lane: { ...base.lane, thresholds: { left, right } },
    jump: { ...base.jump, minimumDisplacement: jump },
    crouch: { ...base.crouch, enterDrop: crouchEnter, exitDrop: Math.min(crouchExit, crouchEnter) },
  };
}

// --- storage -----------------------------------------------------------------

export const CALIBRATION_STORAGE_KEY = "motion-runner.calibration.v1";

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNullableNumber = (v: unknown): v is number | null => v === null || isFiniteNumber(v);

/** Validate stored data; returns null for anything that is not a usable calibration. */
export function parseCalibration(raw: unknown): CalibrationResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || !isFiniteNumber(r.standX) || !isFiniteNumber(r.hipY) || !isFiniteNumber(r.torsoLength) || !isFiniteNumber(r.createdAt)) return null;
  if (r.standX < 0 || r.standX > 1 || r.torsoLength <= 0) return null;
  if (![r.leftX, r.rightX, r.jumpPeak, r.crouchDrop].every(isNullableNumber)) return null;
  return {
    version: 1,
    createdAt: r.createdAt,
    standX: r.standX,
    hipY: r.hipY,
    torsoLength: r.torsoLength,
    leftX: r.leftX as number | null,
    rightX: r.rightX as number | null,
    jumpPeak: r.jumpPeak as number | null,
    crouchDrop: r.crouchDrop as number | null,
  };
}

export function loadCalibration(store: KeyValueStore | null): CalibrationResult | null {
  try {
    const text = store?.getItem(CALIBRATION_STORAGE_KEY);
    return text ? parseCalibration(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

export function saveCalibration(store: KeyValueStore | null, result: CalibrationResult): boolean {
  try {
    store?.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(result));
    return store !== null;
  } catch {
    return false;
  }
}
