import type { AnswerMappingConfig } from "./AnswerMapping";
import type { Question } from "./Question";
import { QuestionBank, QuestionDataError } from "./QuestionBank";

/** What loading one question file came to. */
export interface QuestionFileReport {
  file: string;
  /** Questions taken from the file (0 when it failed). */
  loaded: number;
  /** Why the file was skipped, when it was. */
  error?: string;
}

export interface QuestionLoadResult {
  /** The questions from every file that loaded, or null when none did. */
  bank: QuestionBank | null;
  reports: QuestionFileReport[];
  /** Everything that went wrong, in plain words, for the console and the menu. */
  problems: string[];
}

/** The part of `fetch` the loader needs, so tests can supply files without a server. */
export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*\.json$/;

/** True for a plain "name.json" in the questions folder: no paths, no ".." and no other extensions. */
export function isSafeFileName(name: string): boolean {
  return SAFE_FILE_NAME.test(name);
}

/** "math.json" → "math". Questions in the file belong to this category unless they name their own. */
export function categoryFromFileName(file: string): string {
  return file.replace(/\.json$/i, "").toLowerCase();
}

async function fetchJson(fetchFn: FetchLike, url: string): Promise<unknown> {
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Loads the question bank from a folder of JSON files: `index.json` lists the files, and each
 * file is an array of questions (see public/questions). The files are fetched when the game
 * starts, so questions can be added or edited without rebuilding.
 *
 * Every file is checked on its own. A file that is missing or invalid is skipped and reported,
 * and the rest still load, so one typo never takes the whole game's questions away.
 *
 * @param baseUrl the folder's URL, ending in "/" (e.g. "/questions/")
 */
export async function loadQuestionBank(baseUrl: string, mapping: AnswerMappingConfig, fetchFn: FetchLike = (url) => fetch(url)): Promise<QuestionLoadResult> {
  const problems: string[] = [];
  const reports: QuestionFileReport[] = [];

  // 1. The list of files.
  let manifest: unknown;
  try {
    manifest = await fetchJson(fetchFn, `${baseUrl}index.json`);
  } catch (error) {
    problems.push(`Daftar soal (index.json) tidak bisa dimuat: ${describe(error)}.`);
    return { bank: null, reports, problems };
  }

  const listed = (manifest as { files?: unknown } | null)?.files;
  if (!Array.isArray(listed)) {
    problems.push('index.json harus berisi {"files": ["nama.json", ...]}.');
    return { bank: null, reports, problems };
  }

  const files: string[] = [];
  for (const entry of listed) {
    if (typeof entry === "string" && isSafeFileName(entry)) {
      if (!files.includes(entry)) files.push(entry);
    } else {
      problems.push(`index.json: nama file ${JSON.stringify(entry)} tidak dipakai (harus berupa "nama.json" tanpa folder).`);
    }
  }

  // 2. Each file, fetched together but validated separately.
  const fetched = await Promise.all(
    files.map(async (file) => {
      try {
        return { file, data: await fetchJson(fetchFn, `${baseUrl}${file}`) as unknown };
      } catch (error) {
        return { file, error: describe(error) };
      }
    }),
  );

  const questions: Question[] = [];
  const origin = new Map<string, string>();
  for (const item of fetched) {
    if ("error" in item) {
      reports.push({ file: item.file, loaded: 0, error: item.error });
      problems.push(`${item.file}: tidak bisa dimuat (${item.error}).`);
      continue;
    }

    let fileBank: QuestionBank;
    try {
      fileBank = QuestionBank.fromData(item.data, mapping, { defaultCategory: categoryFromFileName(item.file) });
    } catch (error) {
      const detail = error instanceof QuestionDataError ? error.problems.join(" ") : describe(error);
      reports.push({ file: item.file, loaded: 0, error: detail });
      problems.push(...(error instanceof QuestionDataError ? error.problems.map((p) => `${item.file}: ${p}`) : [`${item.file}: ${detail}`]));
      continue;
    }

    let loaded = 0;
    for (const question of fileBank.questions) {
      const first = origin.get(question.id);
      if (first !== undefined) {
        problems.push(`Soal "${question.id}" di ${item.file} sudah ada di ${first}; yang di ${item.file} diabaikan.`);
        continue;
      }
      origin.set(question.id, item.file);
      questions.push(question);
      loaded++;
    }
    reports.push({ file: item.file, loaded });
  }

  if (questions.length === 0) problems.push("Tidak ada soal yang berhasil dimuat.");
  return { bank: questions.length > 0 ? new QuestionBank(questions) : null, reports, problems };
}
