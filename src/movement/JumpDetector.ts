import type { JumpConfig } from "../config/gameConfig";
import type { JumpState } from "./MovementTypes";

export interface JumpResult {
  /** Lowest pose confidence seen during the jump. */
  confidence: number;
  /** Highest hip displacement reached, in torso units. */
  peakDisplacement: number;
  airTimeMs: number;
}

/**
 * Temporal jump detector: GROUNDED → AIRBORNE → (landed) → COOLDOWN.
 *
 * A jump starts when the hip rises quickly (within the detection window) above
 * the minimum displacement. It is reported as soon as the rise has lasted
 * `confirmMs`, i.e. at take-off, so the game can react while the player is still
 * in the air. A rise that ends sooner than that is noise and is dropped. The
 * cooldown prevents one physical jump from being reported twice.
 */
export class JumpDetector {
  private _state: JumpState = "GROUNDED";
  private lastGroundedAt = Number.NEGATIVE_INFINITY;
  private airborneAt = 0;
  private landedAt = 0;
  private peak = 0;
  private minConfidence = 1;
  private confirmed = false;

  constructor(private readonly config: JumpConfig) {}

  get state(): JumpState {
    return this._state;
  }

  /**
   * @param displacement hip height above standing baseline, in torso units.
   * @returns a result when a jump is confirmed on this frame, otherwise null.
   */
  update(timestamp: number, displacement: number, confidence: number): JumpResult | null {
    const { minimumDisplacement, landingRatio } = this.config;
    const grounded = displacement < minimumDisplacement * landingRatio;

    switch (this._state) {
      case "COOLDOWN":
        if (grounded) this.lastGroundedAt = timestamp;
        if (timestamp - this.landedAt >= this.config.cooldownMs) this._state = "GROUNDED";
        return null;

      case "GROUNDED":
        if (grounded) {
          this.lastGroundedAt = timestamp;
          return null;
        }
        if (
          displacement >= minimumDisplacement &&
          confidence >= this.config.minConfidence &&
          timestamp - this.lastGroundedAt <= this.config.detectionWindowMs
        ) {
          this._state = "AIRBORNE";
          this.airborneAt = timestamp;
          this.peak = displacement;
          this.minConfidence = confidence;
          this.confirmed = false;
        }
        return null;

      case "AIRBORNE": {
        const airTime = timestamp - this.airborneAt;
        if (airTime > this.config.maxAirTimeMs) {
          // Up for too long to be a jump (e.g. standing on something). Require a fresh
          // return to the ground before another jump can start.
          this._state = "GROUNDED";
          this.lastGroundedAt = Number.NEGATIVE_INFINITY;
          return null;
        }
        this.peak = Math.max(this.peak, displacement);
        this.minConfidence = Math.min(this.minConfidence, confidence);

        if (grounded) {
          this.lastGroundedAt = timestamp;
          if (this.confirmed) {
            this._state = "COOLDOWN";
            this.landedAt = timestamp;
          } else {
            this._state = "GROUNDED"; // a spike that ended before it could be confirmed
          }
          return null;
        }

        if (!this.confirmed && airTime >= this.config.confirmMs) {
          this.confirmed = true;
          return { confidence: this.minConfidence, peakDisplacement: this.peak, airTimeMs: airTime };
        }
        return null;
      }
    }
  }

  reset(): void {
    this._state = "GROUNDED";
    this.lastGroundedAt = Number.NEGATIVE_INFINITY;
  }
}
