import { loadQuestionBank, type FetchLike, type QuestionLoadResult } from "../QuestionLoader";
import type { AnswerMappingConfig } from "../AnswerMapping";

/** Every file in public/questions, read at build time by Vite (tests only). */
const files = import.meta.glob("/public/questions/*.json", { eager: true, import: "default" }) as Record<string, unknown>;

/** A fetch that serves the real files from public/questions, as the dev server would. */
export const shippedFetch: FetchLike = async (url) => {
  const data = files[`/public${url}`];
  return { ok: data !== undefined, status: data !== undefined ? 200 : 404, json: async () => data };
};

/** Loads the questions the game really ships with, through the same loader the app uses. */
export function loadShippedQuestions(mapping: AnswerMappingConfig): Promise<QuestionLoadResult> {
  return loadQuestionBank("/questions/", mapping, shippedFetch);
}

/** The names of the shipped question files (from the files on disk, not from index.json). */
export const shippedFileNames: string[] = Object.keys(files)
  .map((path) => path.replace("/public/questions/", ""))
  .filter((name) => name !== "index.json")
  .sort();
