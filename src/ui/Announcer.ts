/**
 * Speaks text to screen readers through an aria-live region. The game canvas is not
 * readable, so questions, results and state changes are announced here instead.
 */
export class Announcer {
  private timer = 0;

  constructor(private readonly region: HTMLElement) {}

  /** Announce `text`. A newer message replaces one that has not been read yet. */
  announce(text: string): void {
    window.clearTimeout(this.timer);
    // Clearing first makes screen readers announce even an identical message again.
    this.region.textContent = "";
    this.timer = window.setTimeout(() => {
      this.region.textContent = text;
    }, 60);
  }
}
