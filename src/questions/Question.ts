import type { Movement } from "../movement/MovementTypes";

/**
 * LANE: the player picks an answer by standing in its lane.
 * MOVEMENT: the player picks an answer by performing its movement (e.g. JUMP).
 */
export type QuestionType = "LANE" | "MOVEMENT";

export type Difficulty = "EASY" | "MEDIUM" | "HARD";

export const DIFFICULTIES: readonly Difficulty[] = ["EASY", "MEDIUM", "HARD"];

/** Category used when a question does not name one. */
export const DEFAULT_CATEGORY = "general";
export const DEFAULT_DIFFICULTY: Difficulty = "EASY";

export interface Answer {
  id: string;
  text: string;
  /** The physical movement that selects this answer. */
  action: Movement;
  correct: boolean;
}

export interface Question {
  id: string;
  text: string;
  type: QuestionType;
  /** Free-form id such as "math" or "science"; shown via a label map in the UI. */
  category: string;
  difficulty: Difficulty;
  /**
   * LANE questions only: whether the order of answers (and so the lanes) may be
   * shuffled each time the question is asked. Never true when the data fixes the actions.
   */
  shuffleAnswers: boolean;
  answers: Answer[];
}

/**
 * Question as written in data files. For LANE questions `action` may be
 * omitted; it is then assigned from the configurable answer mapping.
 */
export interface RawAnswer {
  id?: string;
  text: string;
  correct?: boolean;
  action?: Movement;
}

export interface RawQuestion {
  id: string;
  text: string;
  type: QuestionType;
  category?: string;
  difficulty?: Difficulty;
  /** Set false to keep a LANE question's answers in the written order (default true). */
  shuffleAnswers?: boolean;
  answers: RawAnswer[];
}

/** Outcome of one question, keeping the four concepts separate. */
export interface AnswerResult {
  questionId: string;
  /** Answer the player's movement selected, or null if none matched. */
  selectedAnswerId: string | null;
  /** Movement that the correct answer requires. */
  requiredMovement: Movement;
  /** What the player actually did, or null if no response was detected. */
  actualMovement: Movement | null;
  correct: boolean;
}
