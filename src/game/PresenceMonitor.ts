import type { PresenceConfig } from "../config/gameConfig";

export type PresenceChange = "lost" | "found";

/**
 * Watches whether the camera can see the player. Reports "lost" once the player has
 * been missing for a while, and "found" once they have been back for a while, so a
 * single dropped frame never pauses the game.
 */
export class PresenceMonitor {
  private _present = true;
  private since: number | null = null;

  constructor(private readonly config: PresenceConfig) {}

  /** Whether the player is currently considered to be in view. */
  get present(): boolean {
    return this._present;
  }

  /** Feed the latest tracking state. Returns a change when the debounce time has passed. */
  update(now: number, tracking: boolean): PresenceChange | null {
    // Only a state that contradicts the current one needs time to prove itself.
    if (tracking === this._present) {
      this.since = null;
      return null;
    }
    this.since ??= now;
    const needed = this._present ? this.config.lostAfterMs : this.config.foundAfterMs;
    if (now - this.since < needed) return null;

    this._present = tracking;
    this.since = null;
    return tracking ? "found" : "lost";
  }

  reset(): void {
    this._present = true;
    this.since = null;
  }
}
