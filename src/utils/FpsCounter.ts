/** Counts ticks and reports a smoothed rate over a fixed sampling window. */
export class FpsCounter {
  private count = 0;
  private windowStart = -1;
  private current = 0;

  constructor(private readonly sampleWindowMs: number) {}

  tick(now: number): void {
    if (this.windowStart < 0) this.windowStart = now;
    this.count++;
    const elapsed = now - this.windowStart;
    if (elapsed >= this.sampleWindowMs) {
      this.current = (this.count * 1000) / elapsed;
      this.count = 0;
      this.windowStart = now;
    }
  }

  get fps(): number {
    return this.current;
  }
}
