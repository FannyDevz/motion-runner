import { describe, expect, it } from "vitest";
import { gameConfig } from "../config/gameConfig";
import type { AnswerResult, Question } from "../questions";
import { difficultiesByCloseness, targetDifficulty } from "./Difficulty";
import { RunStats } from "./RunStats";
import { scoreAnswer } from "./Scoring";

const scoring = gameConfig.runner.questions.scoring;
const difficulty = gameConfig.runner.questions.difficulty;

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: "q",
    text: "?",
    type: "LANE",
    category: "math",
    difficulty: "EASY",
    shuffleAnswers: false,
    answers: [],
    ...overrides,
  };
}

const right: AnswerResult = { questionId: "q", selectedAnswerId: "A", requiredMovement: "LEFT", actualMovement: "LEFT", correct: true };
const wrong: AnswerResult = { ...right, selectedAnswerId: "B", actualMovement: "CENTER", correct: false };
const none: AnswerResult = { ...right, selectedAnswerId: null, actualMovement: null, correct: false };

describe("scoreAnswer", () => {
  it("awards base points by difficulty", () => {
    const at = (d: Question["difficulty"]) => scoreAnswer(question({ difficulty: d }), right, 0, 0, scoring);
    expect(at("EASY").base).toBe(scoring.basePoints.EASY);
    expect(at("MEDIUM").base).toBe(scoring.basePoints.MEDIUM);
    expect(at("HARD").base).toBe(scoring.basePoints.HARD);
    expect(scoring.basePoints.HARD).toBeGreaterThan(scoring.basePoints.EASY);
  });

  it("raises the multiplier with the streak, up to the cap", () => {
    const mult = (streak: number) => scoreAnswer(question(), right, streak, 0, scoring).streakMultiplier;
    expect(mult(0)).toBe(1);
    expect(mult(1)).toBeCloseTo(1 + scoring.streakStep);
    expect(mult(3)).toBeCloseTo(1 + 3 * scoring.streakStep);
    expect(mult(1000)).toBe(scoring.maxStreakMultiplier);
  });

  it("multiplies only the base, then adds the speed bonus", () => {
    const s = scoreAnswer(question({ difficulty: "MEDIUM" }), right, 2, 1, scoring);
    expect(s.total).toBe(Math.round(scoring.basePoints.MEDIUM * (1 + 2 * scoring.streakStep)) + scoring.maxSpeedBonus);
  });

  it("scales the speed bonus with the time left and clamps it", () => {
    const bonus = (f: number) => scoreAnswer(question(), right, 0, f, scoring).speedBonus;
    expect(bonus(1)).toBe(scoring.maxSpeedBonus);
    expect(bonus(0.5)).toBe(Math.round(scoring.maxSpeedBonus / 2));
    expect(bonus(0)).toBe(0);
    expect(bonus(-3)).toBe(0);
    expect(bonus(7)).toBe(scoring.maxSpeedBonus);
  });

  it("advances the streak on a correct answer", () => {
    const s = scoreAnswer(question(), right, 4, 0.5, scoring);
    expect(s).toMatchObject({ correct: true, streakBefore: 4, streakAfter: 5 });
  });

  it("applies the penalty and resets the streak on a wrong or missing answer", () => {
    for (const result of [wrong, none]) {
      const s = scoreAnswer(question(), result, 6, 1, scoring);
      expect(s).toMatchObject({ correct: false, base: 0, speedBonus: 0, streakMultiplier: 1, streakAfter: 0, streakBefore: 6 });
      expect(s.total).toBe(scoring.incorrectPoints);
    }
  });

  it("honours a custom configuration", () => {
    const custom = { ...scoring, basePoints: { EASY: 1, MEDIUM: 2, HARD: 3 }, streakStep: 0, maxSpeedBonus: 0, incorrectPoints: 0 };
    expect(scoreAnswer(question({ difficulty: "HARD" }), right, 9, 1, custom).total).toBe(3);
    expect(scoreAnswer(question(), wrong, 0, 1, custom).total).toBe(0);
  });
});

describe("targetDifficulty", () => {
  it("is fixed when configured", () => {
    const fixed = { ...difficulty, mode: "fixed" as const, fixed: "HARD" as const };
    expect(targetDifficulty(0, fixed)).toBe("HARD");
    expect(targetDifficulty(100, fixed)).toBe("HARD");
  });

  it("rises with correct answers when progressive", () => {
    const { MEDIUM, HARD } = difficulty.thresholds;
    expect(targetDifficulty(0, difficulty)).toBe("EASY");
    expect(targetDifficulty(MEDIUM - 1, difficulty)).toBe("EASY");
    expect(targetDifficulty(MEDIUM, difficulty)).toBe("MEDIUM");
    expect(targetDifficulty(HARD - 1, difficulty)).toBe("MEDIUM");
    expect(targetDifficulty(HARD, difficulty)).toBe("HARD");
  });
});

describe("difficultiesByCloseness", () => {
  it("puts the target first, then the nearest, easier first on ties", () => {
    expect(difficultiesByCloseness("EASY")).toEqual(["EASY", "MEDIUM", "HARD"]);
    expect(difficultiesByCloseness("HARD")).toEqual(["HARD", "MEDIUM", "EASY"]);
    expect(difficultiesByCloseness("MEDIUM")).toEqual(["MEDIUM", "EASY", "HARD"]);
  });
});

describe("RunStats", () => {
  const record = (stats: RunStats, q: Question, correct: boolean, streakBefore: number) =>
    stats.record(q, scoreAnswer(q, correct ? right : wrong, streakBefore, 0.5, scoring));

  it("starts empty", () => {
    const s = new RunStats();
    expect(s).toMatchObject({ asked: 0, correct: 0, streak: 0, bestStreak: 0, accuracy: 0 });
    expect(s.byCategory.size).toBe(0);
  });

  it("tracks counts, accuracy, streak and best streak", () => {
    const s = new RunStats();
    const q = question();
    record(s, q, true, 0);
    record(s, q, true, 1);
    record(s, q, true, 2);
    expect(s.streak).toBe(3);
    record(s, q, false, 3);
    expect(s.streak).toBe(0);
    record(s, q, true, 0);
    expect(s).toMatchObject({ asked: 5, correct: 4, streak: 1, bestStreak: 3 });
    expect(s.accuracy).toBeCloseTo(0.8);
  });

  it("breaks results down by category in first-seen order", () => {
    const s = new RunStats();
    record(s, question({ category: "math" }), true, 0);
    record(s, question({ category: "science" }), false, 0);
    record(s, question({ category: "math" }), false, 0);
    expect([...s.byCategory.entries()]).toEqual([
      ["math", { asked: 2, correct: 1 }],
      ["science", { asked: 1, correct: 0 }],
    ]);
  });

  it("resets", () => {
    const s = new RunStats();
    record(s, question(), true, 0);
    s.reset();
    expect(s).toMatchObject({ asked: 0, correct: 0, streak: 0, bestStreak: 0 });
    expect(s.byCategory.size).toBe(0);
  });
});
