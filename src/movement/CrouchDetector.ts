import type { CrouchConfig } from "../config/gameConfig";
import type { CrouchState } from "./MovementTypes";

export type CrouchTransition = "CROUCH_START" | "CROUCH_END";

export interface CrouchSignals {
  /** Hip drop below standing baseline, in torso units (positive = lower). */
  hipDrop: number;
  kneeAngleDeg: number | null;
}

/**
 * True when body geometry indicates the player is lowering. Combines hip drop
 * with knee bend: a bent knee lets a smaller hip drop count, so detection does
 * not hinge on a single landmark.
 */
export function isLowered(signals: CrouchSignals, config: CrouchConfig): boolean {
  if (signals.hipDrop >= config.enterDrop) return true;
  return (
    signals.kneeAngleDeg !== null &&
    signals.kneeAngleDeg <= config.kneeAngleDeg &&
    signals.hipDrop >= config.enterDrop * config.kneeAssistRatio
  );
}

/** True when the hip is back near standing height (exit side of the hysteresis band). */
export function isStanding(signals: CrouchSignals, config: CrouchConfig): boolean {
  return signals.hipDrop < config.exitDrop;
}

/**
 * Crouch state machine: STANDING → LOWERING → CROUCHING → STANDING.
 * Separate enter/exit thresholds (hysteresis) and minimum durations
 * (debouncing) prevent rapid switching.
 */
export class CrouchDetector {
  private _state: CrouchState = "STANDING";
  private lowerSince = 0;
  private standSince: number | null = null;

  constructor(private readonly config: CrouchConfig) {}

  get state(): CrouchState {
    return this._state;
  }

  update(timestamp: number, signals: CrouchSignals, confidence: number): CrouchTransition | null {
    switch (this._state) {
      case "STANDING":
        if (confidence >= this.config.minConfidence && isLowered(signals, this.config)) {
          this._state = "LOWERING";
          this.lowerSince = timestamp;
        }
        return null;

      case "LOWERING":
        if (isStanding(signals, this.config)) {
          this._state = "STANDING";
          return null;
        }
        if (timestamp - this.lowerSince >= this.config.minimumDurationMs) {
          this._state = "CROUCHING";
          this.standSince = null;
          return "CROUCH_START";
        }
        return null;

      case "CROUCHING":
        if (!isStanding(signals, this.config)) {
          this.standSince = null;
          return null;
        }
        this.standSince ??= timestamp;
        if (timestamp - this.standSince >= this.config.exitDurationMs) {
          this._state = "STANDING";
          this.standSince = null;
          return "CROUCH_END";
        }
        return null;
    }
  }

  reset(): void {
    this._state = "STANDING";
    this.standSince = null;
  }
}
