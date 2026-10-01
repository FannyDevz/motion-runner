import type { Lane, Movement } from "../movement/MovementTypes";
import { DEFAULT_CATEGORY, DEFAULT_DIFFICULTY, type Answer, type Question, type RawQuestion } from "./Question";

export const LANE_MOVEMENTS: readonly Movement[] = ["LEFT", "CENTER", "RIGHT"];
export const MOVEMENT_ANSWERS: readonly Movement[] = ["JUMP", "CROUCH"];

export interface AnswerMappingConfig {
  /** Lane for the 1st, 2nd, 3rd… answer of a LANE question (A, B, C…). */
  laneOrder: readonly Lane[];
}

export function isLane(movement: Movement): movement is Lane {
  return LANE_MOVEMENTS.includes(movement);
}

/** Letter label for an answer position: 0 → "A". */
export function answerLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/**
 * Turns a raw question into a fully mapped one. Explicit `action` values in
 * the data always win; otherwise LANE answers get their lane from `laneOrder`
 * by position. MOVEMENT answers must state their action explicitly.
 * Does not validate; see QuestionBank.
 */
export function applyAnswerMapping(raw: RawQuestion, mapping: AnswerMappingConfig, defaultCategory: string = DEFAULT_CATEGORY): Question {
  const answers: Answer[] = raw.answers.map((a, index) => {
    const action = a.action ?? (raw.type === "LANE" ? mapping.laneOrder[index] : undefined);
    if (action === undefined) {
      throw new Error(`Cannot map answer #${index + 1} of "${raw.id}": no action given and none can be derived.`);
    }
    return { id: a.id ?? answerLetter(index), text: a.text, correct: a.correct === true, action };
  });
  // Explicit actions mean the author fixed the mapping, so never reshuffle those.
  const explicitActions = raw.answers.some((a) => a.action !== undefined);
  return {
    id: raw.id,
    text: raw.text,
    type: raw.type,
    category: raw.category ?? defaultCategory,
    difficulty: raw.difficulty ?? DEFAULT_DIFFICULTY,
    shuffleAnswers: raw.type === "LANE" && raw.shuffleAnswers !== false && !explicitActions,
    answers,
  };
}

/**
 * The question as it will be shown this time. A LANE question that allows it gets
 * its answers shuffled, then letters and lanes are reassigned by position, so the
 * correct answer is not always in the same lane. Other questions are returned as-is.
 */
export function presentQuestion(question: Question, mapping: AnswerMappingConfig, random: () => number): Question {
  if (!question.shuffleAnswers) return question;

  const order = [...question.answers];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const answers: Answer[] = order.map((a, index) => ({
    id: answerLetter(index),
    text: a.text,
    correct: a.correct,
    action: mapping.laneOrder[index],
  }));
  return { ...question, answers };
}
