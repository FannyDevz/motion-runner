import { describe, expect, it } from "vitest";
import { gameConfig, type RunnerConfig } from "../config/gameConfig";
import { loadShippedQuestions } from "../questions/testing/shippedQuestions";
import type { Difficulty, RawQuestion } from "../questions";
import { QuestionBank } from "../questions";
import { GameManager } from "./GameManager";
import type { GameState } from "./GameState";
import { QuestionManager, type QuestionSelectionConfig } from "./QuestionManager";
import type { ScoreBreakdown } from "./Scoring";
import { selection } from "./testing/selection";

const FRAME_MS = 16;
const q = gameConfig.runner.questions;
const sm = gameConfig.runner.slowMotion;
const mapping = { laneOrder: q.laneOrder };

/** Obstacles are LEFT barriers; a player in CENTER or RIGHT is never hit. */
const harmless = (): number => 0;

function lane(id: string, difficulty: Difficulty = "EASY", category = "math"): RawQuestion {
  return {
    id,
    text: id,
    type: "LANE",
    category,
    difficulty,
    answers: [{ text: "a" }, { text: "right", correct: true }, { text: "c" }], // correct = B = CENTER
  };
}

function config(questions: Partial<RunnerConfig["questions"]> = {}): RunnerConfig {
  return { ...gameConfig.runner, questions: { ...q, everyNObstacles: 1, ...questions } };
}

function setup(raw: RawQuestion[], select: Partial<QuestionSelectionConfig> = {}, cfg: RunnerConfig = config()) {
  const manager = new QuestionManager(QuestionBank.fromData(raw, mapping), selection(select), harmless);
  const game = new GameManager(cfg, harmless, manager);
  const scores: ScoreBreakdown[] = [];
  const asked: Array<{ id: string; difficulty: Difficulty; category: string }> = [];
  game.on("questionAnswered", ({ score, question }) => {
    scores.push(score);
    asked.push({ id: question.id, difficulty: question.difficulty, category: question.category });
  });
  game.start();
  return { game, scores, asked };
}

function runUntil(game: GameManager, done: () => boolean, maxMs = 120000): number {
  let elapsed = 0;
  while (elapsed < maxMs && !done()) {
    game.update(FRAME_MS);
    elapsed += FRAME_MS;
  }
  return elapsed;
}

const inState = (game: GameManager, state: GameState) => (): boolean => game.state === state;
const answered = (scores: ScoreBreakdown[], n: number) => (): boolean => scores.length >= n;

describe("scoring in play", () => {
  it("awards difficulty-based points with a growing streak multiplier and full speed bonus", () => {
    const { game, scores } = setup([lane("a"), lane("b"), lane("c")]);
    runUntil(game, answered(scores, 3));
    const { basePoints, streakStep, maxSpeedBonus } = q.scoring;

    expect(scores.map((s) => s.base)).toEqual([basePoints.EASY, basePoints.EASY, basePoints.EASY]);
    expect(scores.map((s) => s.streakMultiplier)).toEqual([1, 1 + streakStep, 1 + 2 * streakStep]);
    // The player never left the correct lane, so the decision was instant.
    expect(scores.map((s) => s.speedBonus)).toEqual([maxSpeedBonus, maxSpeedBonus, maxSpeedBonus]);
    expect(scores.map((s) => s.total)).toEqual(
      [0, 1, 2].map((streak) => Math.round(basePoints.EASY * (1 + streak * streakStep)) + maxSpeedBonus),
    );
    expect(game.stats.streak).toBe(3);
  });

  it("pays more for harder questions", () => {
    const { game, scores } = setup([lane("h", "HARD")], { difficulty: { ...q.difficulty, mode: "fixed", fixed: "HARD" } });
    runUntil(game, answered(scores, 1));
    expect(scores[0].base).toBe(q.scoring.basePoints.HARD);
    expect(scores[0].base).toBeGreaterThan(q.scoring.basePoints.EASY);
  });

  it("adds the points to the score", () => {
    const flat = { ...q.scoring, streakStep: 0, maxSpeedBonus: 0 };
    const { game, scores } = setup([lane("a")], {}, config({ scoring: flat }));
    runUntil(game, answered(scores, 1));
    expect(game.score).toBeGreaterThanOrEqual(flat.basePoints.EASY);
  });

  it("gives a smaller speed bonus the later the player settles on the answer", () => {
    const { game, scores } = setup([lane("a")]);
    game.handleMovement("RIGHT"); // wrong lane first (harmless: obstacles run in LEFT)
    runUntil(game, inState(game, "WAITING_FOR_MOVEMENT"));
    for (let t = 0; t < 1000; t += FRAME_MS) game.update(FRAME_MS);
    game.handleMovement("CENTER");
    runUntil(game, answered(scores, 1));

    const expectedFraction = 1 - 1000 / sm.responseWindowMs;
    expect(scores[0].correct).toBe(true);
    expect(scores[0].speedBonus).toBeLessThan(q.scoring.maxSpeedBonus);
    expect(scores[0].speedBonus).toBeCloseTo(q.scoring.maxSpeedBonus * expectedFraction, -0.5);
  });

  it("resets the streak and applies the penalty for a wrong answer", () => {
    const { game, scores } = setup([lane("a"), lane("b"), lane("c")]);
    runUntil(game, answered(scores, 1));
    expect(game.stats.streak).toBe(1);

    game.handleMovement("RIGHT"); // wrong for the next question
    runUntil(game, answered(scores, 2));
    expect(scores[1]).toMatchObject({ correct: false, streakAfter: 0, total: q.scoring.incorrectPoints });
    expect(game.stats.streak).toBe(0);
    expect(game.stats.bestStreak).toBe(1);
  });

  it("restarts the streak multiplier after a miss", () => {
    const { game, scores } = setup([lane("a"), lane("b"), lane("c"), lane("d")]);
    runUntil(game, answered(scores, 1));
    game.handleMovement("RIGHT");
    runUntil(game, answered(scores, 2));
    game.handleMovement("CENTER");
    runUntil(game, answered(scores, 3));
    expect(scores[2]).toMatchObject({ correct: true, streakBefore: 0, streakMultiplier: 1 });
  });

  it("never lets the score go below zero", () => {
    const harsh = { ...q.scoring, incorrectPoints: -1000 };
    const { game, scores } = setup([lane("a")], {}, config({ scoring: harsh }));
    game.handleMovement("RIGHT");
    runUntil(game, answered(scores, 1));
    expect(game.score).toBe(0);
  });

  it("reports the breakdown in the questionAnswered event", () => {
    const { game } = setup([lane("a")]);
    let seen: ScoreBreakdown | null = null;
    game.on("questionAnswered", ({ score }) => (seen = score));
    runUntil(game, () => seen !== null);
    expect(seen).toMatchObject({ correct: true, base: q.scoring.basePoints.EASY });
  });
});

describe("run statistics", () => {
  it("counts questions, accuracy and categories", () => {
    const { game, scores } = setup([lane("m1", "EASY", "math"), lane("s1", "EASY", "science"), lane("m2", "EASY", "math")]);
    runUntil(game, answered(scores, 1));
    game.handleMovement("RIGHT"); // miss the second
    runUntil(game, answered(scores, 2));
    game.handleMovement("CENTER");
    runUntil(game, answered(scores, 3));

    expect(game.stats).toMatchObject({ asked: 3, correct: 2, bestStreak: 1 });
    expect(game.stats.accuracy).toBeCloseTo(2 / 3);
    const byCategory = Object.fromEntries(game.stats.byCategory);
    expect(Object.values(byCategory).reduce((n, c) => n + c.asked, 0)).toBe(3);
    expect(Object.keys(byCategory).sort()).toEqual(["math", "science"]);
  });

  it("clears on restart", () => {
    const { game, scores } = setup([lane("a")]);
    runUntil(game, answered(scores, 1));
    game.obstacles.push({ id: 999, kind: "BARRIER", lane: game.player.lane, progress: 1, passed: false });
    game.update(FRAME_MS);
    expect(game.state).toBe("GAME_OVER");
    expect(game.stats.asked).toBe(1); // still available for the summary screen

    game.start();
    expect(game.stats).toMatchObject({ asked: 0, correct: 0, streak: 0, bestStreak: 0 });
  });
});

describe("difficulty in play", () => {
  const graded = [1, 2, 3, 4].flatMap((i) => [lane(`e${i}`, "EASY"), lane(`m${i}`, "MEDIUM"), lane(`h${i}`, "HARD")]);

  it("rises as the player answers correctly", () => {
    const thresholds = { MEDIUM: 2, HARD: 4 };
    const { game, asked, scores } = setup(graded, { difficulty: { ...q.difficulty, mode: "progressive", thresholds } });
    runUntil(game, answered(scores, 6));
    expect(asked.map((a) => a.difficulty)).toEqual(["EASY", "EASY", "MEDIUM", "MEDIUM", "HARD", "HARD"]);
  });

  it("stays easy while the player keeps missing", () => {
    const thresholds = { MEDIUM: 2, HARD: 4 };
    const { game, asked, scores } = setup(graded, { difficulty: { ...q.difficulty, mode: "progressive", thresholds } });
    game.handleMovement("RIGHT");
    runUntil(game, answered(scores, 4));
    expect(new Set(asked.map((a) => a.difficulty))).toEqual(new Set(["EASY"]));
  });
});

describe("sample question bank", async () => {
  const { bank: loaded } = await loadShippedQuestions(mapping);
  const bank = loaded as QuestionBank;
  const byCategory = (cat: string) => bank.questions.filter((x) => x.category === cat);

  it("has every configured category label, and no category without one", () => {
    expect(new Set(bank.categories)).toEqual(new Set(Object.keys(q.categoryLabels)));
  });

  it("offers every difficulty in every category, so progression has something to draw from", () => {
    for (const c of bank.categories) expect(new Set(byCategory(c).map((x) => x.difficulty)).size).toBe(3);
  });

  it("has plenty of questions at each difficulty", () => {
    for (const d of ["EASY", "MEDIUM", "HARD"] as const) {
      expect(bank.questions.filter((x) => x.difficulty === d).length).toBeGreaterThanOrEqual(8);
    }
  });

  it("works with every single category on its own", () => {
    for (const cat of bank.categories) {
      const m = new QuestionManager(bank, selection({ categories: [cat], shuffle: true, shuffleAnswers: true }), harmless);
      expect(m.poolSize).toBe(byCategory(cat).length);
      for (let i = 0; i < 25; i++) expect(m.next().question.category).toBe(cat);
    }
  });

  it("gives every question exactly one correct answer after shuffling", () => {
    const m = new QuestionManager(bank, selection({ shuffle: true, shuffleAnswers: true }), harmless);
    for (let i = 0; i < bank.size * 2; i++) {
      const { question } = m.next();
      expect(question.answers.filter((a) => a.correct)).toHaveLength(1);
    }
  });
});
