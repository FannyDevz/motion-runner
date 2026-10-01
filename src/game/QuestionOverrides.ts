import type { QuestionsConfig } from "../config/gameConfig";
import { DIFFICULTIES, type Difficulty } from "../questions";

/**
 * Applies URL overrides to the questions config, so categories and difficulty
 * can be picked without editing code, e.g. `?categories=math,science&difficulty=hard`.
 *  - categories: comma-separated ids; blank or missing leaves the config untouched.
 *  - difficulty: easy | medium | hard (fixed) or progressive. Anything else is ignored.
 */
export function applyQuestionOverrides(base: QuestionsConfig, search: string): QuestionsConfig {
  const params = new URLSearchParams(search);
  let result = base;

  const categories = (params.get("categories") ?? "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c !== "");
  if (categories.length > 0) result = { ...result, categories };

  const difficulty = params.get("difficulty")?.trim().toUpperCase();
  if (difficulty === "PROGRESSIVE") {
    result = { ...result, difficulty: { ...result.difficulty, mode: "progressive" } };
  } else if (difficulty && DIFFICULTIES.includes(difficulty as Difficulty)) {
    result = { ...result, difficulty: { ...result.difficulty, mode: "fixed", fixed: difficulty as Difficulty } };
  }
  return result;
}
