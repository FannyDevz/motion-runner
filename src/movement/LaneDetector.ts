import type { LaneConfig } from "../config/gameConfig";
import type { Lane } from "./MovementTypes";

/**
 * Classifies a normalized x position into a lane. When `current` is given,
 * the boundaries are pushed `hysteresis` away from the current lane so small
 * jitter around a boundary does not cause switching.
 */
export function detectLane(
  x: number,
  current: Lane | null,
  thresholds: LaneConfig["thresholds"],
  hysteresis: number,
): Lane {
  let leftBoundary = thresholds.left;
  let rightBoundary = thresholds.right;
  if (current === "LEFT") {
    leftBoundary += hysteresis;
    rightBoundary += hysteresis;
  } else if (current === "CENTER") {
    leftBoundary -= hysteresis;
    rightBoundary += hysteresis;
  } else if (current === "RIGHT") {
    leftBoundary -= hysteresis;
    rightBoundary -= hysteresis;
  }

  if (x < leftBoundary) return "LEFT";
  if (x > rightBoundary) return "RIGHT";
  return "CENTER";
}

/** Smooths body-center x and debounces lane changes over time. */
export class LaneDetector {
  private _lane: Lane | null = null;
  private _smoothedX = 0.5;
  private hasSample = false;
  private candidate: Lane | null = null;
  private candidateSince = 0;

  constructor(private readonly config: LaneConfig) {}

  get lane(): Lane | null {
    return this._lane;
  }

  get smoothedX(): number {
    return this._smoothedX;
  }

  /** Returns the new lane when it changes, otherwise null. */
  update(timestamp: number, x: number): Lane | null {
    if (!this.hasSample) {
      this._smoothedX = x;
      this.hasSample = true;
    } else {
      this._smoothedX += (x - this._smoothedX) * this.config.smoothing;
    }

    const detected = detectLane(this._smoothedX, this._lane, this.config.thresholds, this.config.hysteresis);
    if (this._lane === null) {
      this._lane = detected;
      return detected;
    }
    if (detected === this._lane) {
      this.candidate = null;
      return null;
    }
    if (detected !== this.candidate) {
      this.candidate = detected;
      this.candidateSince = timestamp;
    }
    if (timestamp - this.candidateSince >= this.config.minStableMs) {
      this._lane = detected;
      this.candidate = null;
      return detected;
    }
    return null;
  }

  reset(): void {
    this._lane = null;
    this.hasSample = false;
    this.candidate = null;
  }
}
