import type { Question } from "../questions";
import type { ScoreBreakdown } from "./Scoring";

export interface CategoryStats {
  asked: number;
  correct: number;
}

/** Question statistics for one run, shown on the game-over screen. */
export class RunStats {
  private _asked = 0;
  private _correct = 0;
  private _streak = 0;
  private _bestStreak = 0;
  private readonly _byCategory = new Map<string, CategoryStats>();

  get asked(): number {
    return this._asked;
  }

  get correct(): number {
    return this._correct;
  }

  /** Current run of consecutive correct answers. */
  get streak(): number {
    return this._streak;
  }

  get bestStreak(): number {
    return this._bestStreak;
  }

  /** Fraction of questions answered correctly (0 when none were asked). */
  get accuracy(): number {
    return this._asked === 0 ? 0 : this._correct / this._asked;
  }

  /** Per-category results in the order the categories first appeared. */
  get byCategory(): ReadonlyMap<string, CategoryStats> {
    return this._byCategory;
  }

  record(question: Question, score: ScoreBreakdown): void {
    this._asked++;
    const entry = this._byCategory.get(question.category) ?? { asked: 0, correct: 0 };
    entry.asked++;
    if (score.correct) {
      this._correct++;
      entry.correct++;
    }
    this._byCategory.set(question.category, entry);

    this._streak = score.streakAfter;
    this._bestStreak = Math.max(this._bestStreak, this._streak);
  }

  reset(): void {
    this._asked = 0;
    this._correct = 0;
    this._streak = 0;
    this._bestStreak = 0;
    this._byCategory.clear();
  }
}
