import type { QuestionsConfig } from "../config/gameConfig";
import type { Question, QuestionBank } from "../questions";
import { presentQuestion, QuestionSession } from "../questions";
import { difficultiesByCloseness, targetDifficulty } from "./Difficulty";

export type Random = () => number;

/** The part of the questions config that decides what is asked and how it is laid out. */
export type QuestionSelectionConfig = Pick<
  QuestionsConfig,
  "shuffle" | "shuffleAnswers" | "categories" | "difficulty" | "laneOrder"
>;

/**
 * Chooses which question is asked next.
 *
 *  - Only questions in the configured categories are used.
 *  - Difficulty is fixed or rises with the player's correct answers.
 *  - A question is not asked again until every eligible question has been asked
 *    (one cycle), and never twice in a row across a cycle boundary.
 *  - When shuffling, the pick is random and prefers a different category from the
 *    last question; otherwise questions are asked in bank order.
 *  - LANE questions can have their answers (and so the correct lane) shuffled.
 */
export class QuestionManager {
  private readonly eligible: Question[];
  private readonly asked = new Set<string>();
  private correctCount = 0;
  private lastId: string | null = null;
  private lastCategory: string | null = null;

  constructor(
    bank: QuestionBank,
    private readonly config: QuestionSelectionConfig,
    private readonly random: Random = Math.random,
  ) {
    const inCategories = bank.filterByCategory(config.categories);
    if (inCategories.length === 0) {
      const wanted = config.categories?.join(", ") ?? "(any)";
      throw new Error(
        `No questions match the configured categories: ${wanted}. Available: ${bank.categories.join(", ") || "(none)"}.`,
      );
    }

    // In fixed mode only that difficulty is asked, unless the bank has none of it.
    const fixed = config.difficulty.mode === "fixed" ? inCategories.filter((q) => q.difficulty === config.difficulty.fixed) : [];
    this.eligible = fixed.length > 0 ? fixed : inCategories;
  }

  /** Number of questions that can be asked. */
  get poolSize(): number {
    return this.eligible.length;
  }

  /** Difficulty the next question aims for. */
  get currentTarget() {
    return targetDifficulty(this.correctCount, this.config.difficulty);
  }

  /** Start a session for the next question. */
  next(): QuestionSession {
    const question = this.pick();
    this.asked.add(question.id);
    this.lastId = question.id;
    this.lastCategory = question.category;

    const presented = this.config.shuffleAnswers
      ? presentQuestion(question, { laneOrder: this.config.laneOrder }, this.random)
      : question;
    return new QuestionSession(presented);
  }

  /** Tell the manager how the last question went, so difficulty can adapt. */
  recordResult(correct: boolean): void {
    if (correct) this.correctCount++;
  }

  reset(): void {
    this.asked.clear();
    this.correctCount = 0;
    this.lastId = null;
    this.lastCategory = null;
  }

  private pick(): Question {
    let candidates = this.eligible.filter((q) => !this.asked.has(q.id));
    if (candidates.length === 0) {
      // Every question has been asked: start a new cycle.
      this.asked.clear();
      candidates = this.eligible.filter((q) => q.id !== this.lastId || this.eligible.length === 1);
    }

    // Nearest available difficulty to the target.
    let pool = candidates;
    for (const difficulty of difficultiesByCloseness(this.currentTarget)) {
      const matching = candidates.filter((q) => q.difficulty === difficulty);
      if (matching.length > 0) {
        pool = matching;
        break;
      }
    }

    if (!this.config.shuffle) return pool[0];

    const varied = pool.filter((q) => q.category !== this.lastCategory);
    const choices = varied.length > 0 ? varied : pool;
    return choices[Math.floor(this.random() * choices.length)];
  }
}
