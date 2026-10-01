import type { Movement } from "../movement/MovementTypes";
import { LANE_MOVEMENTS, MOVEMENT_ANSWERS, applyAnswerMapping, type AnswerMappingConfig } from "./AnswerMapping";
import { DIFFICULTIES, type Difficulty, type Question, type QuestionType, type RawQuestion } from "./Question";

export class QuestionDataError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid question data:\n- ${problems.join("\n- ")}`);
  }
}

const QUESTION_TYPES: readonly QuestionType[] = ["LANE", "MOVEMENT"];
const KNOWN_MOVEMENTS: readonly string[] = [...LANE_MOVEMENTS, ...MOVEMENT_ANSWERS];
const MIN_ANSWERS = 2;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks one raw item's shape. Returns problems; an empty result means the
 * item is safe to map. `seenIds` is shared across items to catch duplicates.
 */
function validateRawItem(item: unknown, index: number, seenIds: Set<string>, mapping: AnswerMappingConfig): string[] {
  const where = `#${index + 1}`;
  if (!isObject(item)) return [`Question ${where} is not an object.`];

  const problems: string[] = [];
  const hasId = typeof item.id === "string" && item.id !== "";
  const label = hasId ? `"${item.id as string}"` : where;

  if (!hasId) problems.push(`Question ${where} needs a non-empty string id.`);
  else if (seenIds.has(item.id as string)) problems.push(`Duplicate question id ${label}.`);
  else seenIds.add(item.id as string);

  if (typeof item.text !== "string" || item.text.trim() === "") problems.push(`Question ${label} needs text.`);
  if (!QUESTION_TYPES.includes(item.type as QuestionType)) {
    problems.push(`Question ${label} has unknown type ${JSON.stringify(item.type)}.`);
  }
  if (item.category !== undefined && (typeof item.category !== "string" || item.category.trim() === "")) {
    problems.push(`Question ${label} has an invalid category (use a non-empty string).`);
  }
  if (item.difficulty !== undefined && !DIFFICULTIES.includes(item.difficulty as Difficulty)) {
    problems.push(`Question ${label} has unknown difficulty ${JSON.stringify(item.difficulty)} (use ${DIFFICULTIES.join("/")}).`);
  }
  if (item.shuffleAnswers !== undefined && typeof item.shuffleAnswers !== "boolean") {
    problems.push(`Question ${label} shuffleAnswers must be true or false.`);
  }
  if (!Array.isArray(item.answers)) {
    problems.push(`Question ${label} needs an answers array.`);
    return problems;
  }

  item.answers.forEach((a: unknown, j: number) => {
    const answerLabel = `Question ${label} answer #${j + 1}`;
    if (!isObject(a) || typeof a.text !== "string" || a.text.trim() === "") {
      problems.push(`${answerLabel} needs text.`);
      return;
    }
    if (a.action !== undefined && !KNOWN_MOVEMENTS.includes(a.action as Movement)) {
      problems.push(`${answerLabel} has unknown action ${JSON.stringify(a.action)}.`);
    } else if (a.action === undefined && item.type === "MOVEMENT") {
      problems.push(`${answerLabel} needs an explicit action (MOVEMENT questions have no default mapping).`);
    } else if (a.action === undefined && item.type === "LANE" && j >= mapping.laneOrder.length) {
      problems.push(`${answerLabel} has no lane: the answer mapping only covers ${mapping.laneOrder.length} answers.`);
    }
  });
  return problems;
}

/** Checks a mapped question against rules that depend on the final answer actions. */
function validateMapped(question: Question): string[] {
  const problems: string[] = [];
  const id = `"${question.id}"`;
  const { answers } = question;

  if (answers.length < MIN_ANSWERS) problems.push(`Question ${id} needs at least ${MIN_ANSWERS} answers.`);

  const correctCount = answers.filter((a) => a.correct).length;
  if (correctCount !== 1) problems.push(`Question ${id} must have exactly one correct answer (found ${correctCount}).`);

  if (new Set(answers.map((a) => a.id)).size !== answers.length) problems.push(`Question ${id} has duplicate answer ids.`);
  if (new Set(answers.map((a) => a.action)).size !== answers.length) {
    problems.push(`Question ${id} maps two answers to the same movement.`);
  }

  const allowed = question.type === "LANE" ? LANE_MOVEMENTS : MOVEMENT_ANSWERS;
  for (const a of answers) {
    if (!allowed.includes(a.action)) {
      problems.push(`Question ${id} answer "${a.id}" uses ${a.action}, but ${question.type} questions allow ${allowed.join("/")}.`);
    }
  }
  return problems;
}

/** Validated, immutable collection of mapped questions. */
export class QuestionBank {
  private readonly byId = new Map<string, Question>();

  constructor(readonly questions: readonly Question[]) {
    for (const q of questions) this.byId.set(q.id, q);
  }

  /**
   * Build a bank from untrusted data (e.g. a JSON file). Every question is
   * checked independently, and a QuestionDataError lists all problems found.
   */
  static fromData(data: unknown, mapping: AnswerMappingConfig, options: { defaultCategory?: string } = {}): QuestionBank {
    if (!Array.isArray(data)) throw new QuestionDataError(["Question data must be an array."]);

    const problems: string[] = [];
    const mapped: Question[] = [];
    const seenIds = new Set<string>();

    data.forEach((item: unknown, index: number) => {
      const itemProblems = validateRawItem(item, index, seenIds, mapping);
      problems.push(...itemProblems);
      if (itemProblems.length > 0) return;

      const question = applyAnswerMapping(item as RawQuestion, mapping, options.defaultCategory);
      problems.push(...validateMapped(question));
      mapped.push(question);
    });

    if (problems.length > 0) throw new QuestionDataError(problems);
    return new QuestionBank(mapped);
  }

  get size(): number {
    return this.questions.length;
  }

  /** Distinct category ids present in the bank, in first-seen order. */
  get categories(): string[] {
    return [...new Set(this.questions.map((q) => q.category))];
  }

  /** Questions in the given categories (all of them when `categories` is null). */
  filterByCategory(categories: readonly string[] | null): Question[] {
    if (categories === null) return [...this.questions];
    const wanted = new Set(categories);
    return this.questions.filter((q) => wanted.has(q.category));
  }

  get(id: string): Question | undefined {
    return this.byId.get(id);
  }
}
