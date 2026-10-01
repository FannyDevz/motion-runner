import type { Movement } from "../movement/MovementTypes";
import type { AnswerResult, Question } from "./Question";

/**
 * Judges a response against a question. A movement is never "correct" by
 * itself: it must select an answer, and that answer must be the correct one.
 * A null `actual` (no response) or a movement that matches no answer yields
 * no selected answer and an incorrect result.
 */
export function evaluateAnswer(question: Question, actual: Movement | null): AnswerResult {
  const correctAnswer = question.answers.find((a) => a.correct);
  if (!correctAnswer) throw new Error(`Question "${question.id}" has no correct answer.`);

  const selected = actual === null ? undefined : question.answers.find((a) => a.action === actual);
  return {
    questionId: question.id,
    selectedAnswerId: selected?.id ?? null,
    requiredMovement: correctAnswer.action,
    actualMovement: actual,
    correct: selected?.correct === true,
  };
}
