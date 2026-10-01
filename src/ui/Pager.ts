/** Which page of a multi-page screen (like the how-to-play guide) is showing. Pure, so it is easy to test. */
export class Pager {
  private _index = 0;

  constructor(readonly count: number) {
    if (!Number.isInteger(count) || count < 1) throw new Error("A pager needs at least one page.");
  }

  get index(): number {
    return this._index;
  }

  get isFirst(): boolean {
    return this._index === 0;
  }

  get isLast(): boolean {
    return this._index === this.count - 1;
  }

  /** "2 / 5" for display. */
  get label(): string {
    return `${this._index + 1} / ${this.count}`;
  }

  /** Move forward; returns false (and stays put) on the last page. */
  next(): boolean {
    if (this.isLast) return false;
    this._index++;
    return true;
  }

  /** Move back; returns false (and stays put) on the first page. */
  previous(): boolean {
    if (this.isFirst) return false;
    this._index--;
    return true;
  }

  /** Jump to a page, clamped to the valid range. */
  goTo(index: number): void {
    this._index = Math.min(this.count - 1, Math.max(0, Math.trunc(index)));
  }

  reset(): void {
    this._index = 0;
  }
}
