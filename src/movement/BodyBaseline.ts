import type { BaselineConfig } from "../config/gameConfig";

/**
 * Tracks the player's standing hip height and torso length. Jump and crouch
 * are measured relative to this baseline, in torso units.
 *
 * During warm-up every valid sample is averaged. Afterwards the baseline only
 * adapts slowly, and only while the player is standing near it, so a jump or
 * crouch does not drag it along.
 */
export class BodyBaseline {
  private _hipY = 0;
  private _torsoLength = 0;
  private samples = 0;

  constructor(private readonly config: BaselineConfig) {}

  get ready(): boolean {
    return this.samples >= this.config.warmupSamples;
  }

  get hipY(): number {
    return this._hipY;
  }

  get torsoLength(): number {
    return this._torsoLength;
  }

  /** Hip height above baseline in torso units (positive = higher than standing). */
  displacement(hipY: number): number {
    if (this._torsoLength <= 0) return 0;
    return (this._hipY - hipY) / this._torsoLength;
  }

  update(hipY: number, torsoLength: number, canAdapt: boolean): void {
    if (!this.ready) {
      this.samples++;
      const alpha = 1 / this.samples;
      this._hipY += (hipY - this._hipY) * alpha;
      this._torsoLength += (torsoLength - this._torsoLength) * alpha;
      return;
    }
    if (!canAdapt || Math.abs(this.displacement(hipY)) > this.config.updateBand) return;
    const alpha = this.config.smoothing;
    this._hipY += (hipY - this._hipY) * alpha;
    this._torsoLength += (torsoLength - this._torsoLength) * alpha;
  }

  reset(): void {
    this._hipY = 0;
    this._torsoLength = 0;
    this.samples = 0;
  }
}
