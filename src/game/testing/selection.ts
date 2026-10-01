import { gameConfig } from "../../config/gameConfig";
import type { QuestionSelectionConfig } from "../QuestionManager";

/**
 * Deterministic question selection for tests: bank order, no answer shuffling,
 * no category filter. Pass overrides to turn individual features back on.
 */
export function selection(overrides: Partial<QuestionSelectionConfig> = {}): QuestionSelectionConfig {
  const { difficulty, laneOrder } = gameConfig.runner.questions;
  return { shuffle: false, shuffleAnswers: false, categories: null, difficulty, laneOrder, ...overrides };
}
