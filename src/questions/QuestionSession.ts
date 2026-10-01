import type { Lane, Movement } from "../movement/MovementTypes";
import { evaluateAnswer } from "./AnswerValidation";
import type { AnswerResult, Question } from "./Question";

/**
 * One question being answered. Collects the player's response according to
 * the question type:
 *  - LANE: the lane the player stands in when the question resolves.
 *  - MOVEMENT: the last answer movement (e.g. JUMP) performed during the session.
 */
export class QuestionSession {
  private lastMovement: Movement | null = null;

  constructor(readonly question: Question) {}

  /** Record a movement event. Returns true if it counted as a response (it selects an answer). */
  recordMovement(movement: Movement): boolean {
    if (this.question.type !== "MOVEMENT") return false;
    if (!this.question.answers.some((a) => a.action === movement)) return false;
    this.lastMovement = movement;
    return true;
  }

  /** The movement that would be judged right now, or null if there is none yet. */
  currentResponse(lane: Lane): Movement | null {
    return this.question.type === "LANE" ? lane : this.lastMovement;
  }

  /** Id of the answer the current response selects, for live highlighting. */
  currentSelection(lane: Lane): string | null {
    const response = this.currentResponse(lane);
    return this.question.answers.find((a) => a.action === response)?.id ?? null;
  }

  resolve(lane: Lane): AnswerResult {
    return evaluateAnswer(this.question, this.currentResponse(lane));
  }
}
