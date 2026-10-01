import { describe, expect, it } from "vitest";
import { gameConfig } from "../config/gameConfig";
import type { Difficulty, RawQuestion } from "../questions";
import { QuestionBank } from "../questions";
import { QuestionManager } from "./QuestionManager";
import { selection } from "./testing/selection";

const mapping = { laneOrder: gameConfig.runner.questions.laneOrder };
const progressive = gameConfig.runner.questions.difficulty; // MEDIUM at 3 correct, HARD at 8

/** Small deterministic PRNG (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lane(id: string, category = "math", difficulty: Difficulty = "EASY", extra: Partial<RawQuestion> = {}): RawQuestion {
  return {
    id,
    text: id,
    type: "LANE",
    category,
    difficulty,
    answers: [{ text: "wrong 1" }, { text: "right", correct: true }, { text: "wrong 2" }],
    ...extra,
  };
}

function bank(...raw: RawQuestion[]): QuestionBank {
  return QuestionBank.fromData(raw, mapping);
}

/** Ask `n` questions, feeding results back as correct (or not). */
function ask(m: QuestionManager, n: number, correct = true): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(m.next().question.id);
    m.recordResult(correct);
  }
  return ids;
}

describe("ordering and cycles", () => {
  const four = bank(lane("a"), lane("b"), lane("c"), lane("d"));

  it("asks in bank order when not shuffling, then starts a new cycle", () => {
    const m = new QuestionManager(four, selection());
    expect(ask(m, 6)).toEqual(["a", "b", "c", "d", "a", "b"]);
  });

  it("asks every question once per cycle when shuffling", () => {
    const m = new QuestionManager(four, selection({ shuffle: true }), seeded(7));
    for (let cycle = 0; cycle < 5; cycle++) expect(new Set(ask(m, 4))).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("never repeats a question back-to-back, even across cycles", () => {
    const m = new QuestionManager(four, selection({ shuffle: true }), seeded(3));
    const ids = ask(m, 200);
    ids.forEach((id, i) => i > 0 && expect(id).not.toBe(ids[i - 1]));
  });

  it("copes with a bank of one question", () => {
    const m = new QuestionManager(bank(lane("only")), selection({ shuffle: true }));
    expect(ask(m, 3)).toEqual(["only", "only", "only"]);
  });

  it("starts over on reset", () => {
    const m = new QuestionManager(four, selection());
    ask(m, 2);
    m.reset();
    expect(ask(m, 2)).toEqual(["a", "b"]);
  });
});

describe("categories", () => {
  const mixed = bank(lane("m1", "math"), lane("s1", "science"), lane("m2", "math"), lane("g1", "geography"));

  it("only asks the configured categories", () => {
    const m = new QuestionManager(mixed, selection({ categories: ["math", "geography"] }));
    expect(m.poolSize).toBe(3);
    expect(new Set(ask(m, 12))).toEqual(new Set(["m1", "m2", "g1"]));
  });

  it("asks everything when no categories are set", () => {
    expect(new QuestionManager(mixed, selection({ categories: null })).poolSize).toBe(4);
  });

  it("explains an empty selection, listing what is available", () => {
    expect(() => new QuestionManager(mixed, selection({ categories: ["art"] }))).toThrow(/art.*Available: math, science, geography/);
  });

  it("refuses an empty bank", () => {
    expect(() => new QuestionManager(new QuestionBank([]), selection())).toThrow(/No questions match/);
  });

  it("prefers a different category from the last one when shuffling", () => {
    const wide = bank(...["math", "science", "geography", "language"].flatMap((c) => [lane(`${c}-1`, c), lane(`${c}-2`, c), lane(`${c}-3`, c)]));
    const m = new QuestionManager(wide, selection({ shuffle: true }), seeded(11));
    const cats = ask(m, 11).map((id) => id.split("-")[0]);
    cats.forEach((c, i) => i > 0 && expect(c).not.toBe(cats[i - 1]));
  });
});

describe("difficulty", () => {
  const graded = bank(
    ...[1, 2, 3, 4].flatMap((i) => [lane(`e${i}`, "math", "EASY"), lane(`m${i}`, "math", "MEDIUM"), lane(`h${i}`, "math", "HARD")]),
  );
  const levelOf = (id: string): string => ({ e: "EASY", m: "MEDIUM", h: "HARD" })[id[0] as "e" | "m" | "h"];

  it("fixed mode only asks that difficulty", () => {
    const m = new QuestionManager(graded, selection({ difficulty: { ...progressive, mode: "fixed", fixed: "HARD" } }));
    expect(m.poolSize).toBe(4);
    expect(new Set(ask(m, 10).map(levelOf))).toEqual(new Set(["HARD"]));
  });

  it("fixed mode falls back to every difficulty when the bank has none of it", () => {
    const easyOnly = bank(lane("a"), lane("b"));
    const m = new QuestionManager(easyOnly, selection({ difficulty: { ...progressive, mode: "fixed", fixed: "HARD" } }));
    expect(m.poolSize).toBe(2);
  });

  it("progressive mode starts easy and rises with correct answers", () => {
    const { MEDIUM, HARD } = progressive.thresholds;
    const m = new QuestionManager(graded, selection({ difficulty: progressive }));
    const levels = ask(m, HARD + 1).map(levelOf);
    expect(levels.slice(0, MEDIUM)).toEqual(Array(MEDIUM).fill("EASY"));
    expect(levels[MEDIUM]).toBe("MEDIUM");
    expect(levels[HARD]).toBe("HARD");
  });

  it("wrong answers do not raise the difficulty", () => {
    const m = new QuestionManager(graded, selection({ difficulty: progressive }));
    expect(new Set(ask(m, 4, false).map(levelOf))).toEqual(new Set(["EASY"]));
    expect(m.currentTarget).toBe("EASY");
  });

  it("falls back to the nearest difficulty when the target has run out", () => {
    const small = bank(lane("e1", "math", "EASY"), lane("m1", "math", "MEDIUM"), lane("h1", "math", "HARD"));
    const m = new QuestionManager(small, selection({ difficulty: { ...progressive, mode: "progressive", thresholds: { MEDIUM: 0, HARD: 99 } } }));
    // Target is MEDIUM from the start; once it is used up the nearest (EASY) comes next, then HARD.
    expect(ask(m, 3)).toEqual(["m1", "e1", "h1"]);
  });

  it("resets progress on reset", () => {
    const m = new QuestionManager(graded, selection({ difficulty: progressive }));
    ask(m, progressive.thresholds.HARD);
    expect(m.currentTarget).toBe("HARD");
    m.reset();
    expect(m.currentTarget).toBe("EASY");
  });
});

describe("answer shuffling", () => {
  const sessionsOf = (m: QuestionManager, n: number) => Array.from({ length: n }, () => m.next().question);

  it("moves the correct answer between lanes over time", () => {
    const m = new QuestionManager(bank(lane("q")), selection({ shuffleAnswers: true }), seeded(5));
    const lanes = new Set(sessionsOf(m, 60).map((q) => q.answers.find((a) => a.correct)?.action));
    expect(lanes).toEqual(new Set(["LEFT", "CENTER", "RIGHT"]));
  });

  it("keeps letters and lanes in step with the shuffled positions", () => {
    const m = new QuestionManager(bank(lane("q")), selection({ shuffleAnswers: true }), seeded(9));
    for (const q of sessionsOf(m, 20)) {
      expect(q.answers.map((a) => a.id)).toEqual(["A", "B", "C"]);
      expect(q.answers.map((a) => a.action)).toEqual(["LEFT", "CENTER", "RIGHT"]);
      expect(q.answers.filter((a) => a.correct)).toHaveLength(1);
      expect(q.answers.find((a) => a.correct)?.text).toBe("right");
      expect(q.answers.map((a) => a.text).sort()).toEqual(["right", "wrong 1", "wrong 2"]);
    }
  });

  it("follows a custom lane order", () => {
    const order = ["RIGHT", "LEFT", "CENTER"] as const;
    const m = new QuestionManager(
      QuestionBank.fromData([lane("q")], { laneOrder: order }),
      selection({ shuffleAnswers: true, laneOrder: order }),
      seeded(2),
    );
    expect(m.next().question.answers.map((a) => a.action)).toEqual(order);
  });

  it("does nothing when shuffling is off", () => {
    const m = new QuestionManager(bank(lane("q")), selection({ shuffleAnswers: false }), seeded(5));
    const texts = sessionsOf(m, 5).map((q) => q.answers.map((a) => a.text).join("|"));
    expect(new Set(texts).size).toBe(1);
  });

  it("respects a question that opts out", () => {
    const fixed = lane("q", "math", "EASY", { shuffleAnswers: false });
    const m = new QuestionManager(bank(fixed), selection({ shuffleAnswers: true }), seeded(5));
    const texts = sessionsOf(m, 10).map((q) => q.answers.map((a) => a.text).join("|"));
    expect(new Set(texts)).toEqual(new Set(["wrong 1|right|wrong 2"]));
  });

  it("never reshuffles questions whose actions are fixed in the data", () => {
    const explicit = lane("q", "math", "EASY", {
      answers: [{ text: "x", action: "RIGHT" }, { text: "y", action: "LEFT", correct: true }],
    });
    const m = new QuestionManager(bank(explicit), selection({ shuffleAnswers: true }), seeded(5));
    for (const q of sessionsOf(m, 10)) expect(q.answers.map((a) => a.action)).toEqual(["RIGHT", "LEFT"]);
  });

  it("leaves MOVEMENT questions alone", () => {
    const move: RawQuestion = {
      id: "mv",
      text: "?",
      type: "MOVEMENT",
      answers: [{ text: "Jump", action: "JUMP" }, { text: "Crouch", action: "CROUCH", correct: true }],
    };
    const m = new QuestionManager(bank(move), selection({ shuffleAnswers: true }), seeded(5));
    for (const q of sessionsOf(m, 10)) expect(q.answers.map((a) => a.action)).toEqual(["JUMP", "CROUCH"]);
  });

  it("does not change the question in the bank", () => {
    const b = bank(lane("q"));
    const m = new QuestionManager(b, selection({ shuffleAnswers: true }), seeded(5));
    sessionsOf(m, 10);
    expect(b.get("q")?.answers.map((a) => a.text)).toEqual(["wrong 1", "right", "wrong 2"]);
  });
});
