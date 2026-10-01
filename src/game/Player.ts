import type { RunnerPlayerConfig } from "../config/gameConfig";
import type { Lane } from "../movement/MovementTypes";

export const LANES: readonly Lane[] = ["LEFT", "CENTER", "RIGHT"];

export function laneIndex(lane: Lane): number {
  return LANES.indexOf(lane);
}

/**
 * Player state: current lane, jump arc and crouch timer. Pure logic; the
 * Phaser scene only reads it to draw. Lane changes are instant here (the scene
 * tweens the visual position).
 */
export class Player {
  private _lane: Lane = "CENTER";
  private jumpElapsedMs = -1;
  private crouchRemainingMs = 0;

  constructor(private readonly config: RunnerPlayerConfig) {}

  get lane(): Lane {
    return this._lane;
  }

  moveTo(lane: Lane): void {
    this._lane = lane;
  }

  /** Start a jump. Returns false if it was ignored (already jumping, or crouching). */
  jump(): boolean {
    if (this.jumpElapsedMs >= 0 || this.isCrouching) return false;
    this.jumpElapsedMs = 0;
    return true;
  }

  /** Start (or extend) a crouch. Returns false if it was ignored (mid-jump). */
  crouch(): boolean {
    if (this.jumpElapsedMs >= 0) return false;
    this.crouchRemainingMs = this.config.crouchHoldMs;
    return true;
  }

  /** Jump arc height, 0 (ground) .. 1 (peak). */
  get jumpHeight(): number {
    if (this.jumpElapsedMs < 0) return 0;
    return Math.sin(Math.PI * (this.jumpElapsedMs / this.config.jumpDurationMs));
  }

  get isAirborne(): boolean {
    return this.jumpHeight >= this.config.airborneThreshold;
  }

  get isCrouching(): boolean {
    return this.crouchRemainingMs > 0;
  }

  update(dtMs: number): void {
    if (this.jumpElapsedMs >= 0) {
      this.jumpElapsedMs += dtMs;
      if (this.jumpElapsedMs >= this.config.jumpDurationMs) this.jumpElapsedMs = -1;
    }
    if (this.crouchRemainingMs > 0) this.crouchRemainingMs = Math.max(0, this.crouchRemainingMs - dtMs);
  }

  reset(): void {
    this._lane = "CENTER";
    this.jumpElapsedMs = -1;
    this.crouchRemainingMs = 0;
  }
}
