import { describe, expect, it } from "vitest";
import { gameConfig } from "../config/gameConfig";
import { RunStats } from "../game/RunStats";
import type { ScoreBreakdown } from "../game/Scoring";
import type { AnswerResult, Question } from "../questions";
import { describeGameOver, describeQuestion, describeResult } from "./narration";

const config = gameConfig.runner.questions;

const lane: Question = {
  id: "q",
  text: "Berapa hasil 12 × 3?",
  type: "LANE",
  category: "math",
  difficulty: "MEDIUM",
  shuffleAnswers: false,
  answers: [
    { id: "A", text: "32", action: "LEFT", correct: false },
    { id: "B", text: "36", action: "CENTER", correct: true },
    { id: "C", text: "38", action: "RIGHT", correct: false },
  ],
};

const movement: Question = {
  ...lane,
  type: "MOVEMENT",
  category: "logic",
  difficulty: "EASY",
  text: "Matahari terbit dari timur.",
  answers: [
    { id: "A", text: "Benar", action: "JUMP", correct: true },
    { id: "B", text: "Salah", action: "CROUCH", correct: false },
  ],
};

const right: AnswerResult = { questionId: "q", selectedAnswerId: "B", requiredMovement: "CENTER", actualMovement: "CENTER", correct: true };
const wrong: AnswerResult = { ...right, selectedAnswerId: "A", actualMovement: "LEFT", correct: false };
const none: AnswerResult = { ...right, selectedAnswerId: null, actualMovement: null, correct: false };

const score = (over: Partial<ScoreBreakdown> = {}): ScoreBreakdown => ({
  correct: true,
  base: 75,
  streakMultiplier: 1,
  speedBonus: 0,
  total: 75,
  streakBefore: 0,
  streakAfter: 1,
  ...over,
});

describe("describeQuestion", () => {
  it("names the category and level, reads the question, and says where to move for each answer", () => {
    const text = describeQuestion(lane, config);
    expect(text).toContain("Matematika");
    expect(text).toContain("Sedang");
    expect(text).toContain("Berapa hasil 12 × 3?");
    expect(text).toContain("A, 32, geser ke Kiri");
    expect(text).toContain("B, 36, geser ke Tengah");
    expect(text).toContain("C, 38, geser ke Kanan");
  });

  it("says what to do for movement questions", () => {
    const text = describeQuestion(movement, config);
    expect(text).toContain("A, Benar, lakukan Lompat");
    expect(text).toContain("B, Salah, lakukan Jongkok");
  });

  it("falls back to the raw category id when there is no label", () => {
    expect(describeQuestion({ ...lane, category: "art" }, config)).toContain("Soal art,");
  });
});

describe("describeResult", () => {
  it("announces points and a streak", () => {
    const text = describeResult(lane, right, score({ total: 123, streakAfter: 4 }), config);
    expect(text).toContain("Benar");
    expect(text).toContain("Tambah 123 poin");
    expect(text).toContain("Beruntun 4");
  });

  it("omits the streak for a first correct answer", () => {
    expect(describeResult(lane, right, score(), config)).not.toContain("Beruntun");
  });

  it("gives the right answer and the penalty when wrong", () => {
    const text = describeResult(lane, wrong, score({ correct: false, total: -10, streakAfter: 0 }), config);
    expect(text).toContain("Salah");
    expect(text).toContain("Jawaban: 36");
    expect(text).toContain("Kurang 10 poin");
  });

  it("distinguishes no answer from a wrong answer", () => {
    expect(describeResult(lane, none, score({ correct: false, total: 0 }), config)).toContain("Tidak menjawab");
  });

  it("does not mention a penalty when there is none", () => {
    expect(describeResult(lane, wrong, score({ correct: false, total: 0 }), config)).not.toContain("Kurang");
  });
});

describe("describeGameOver", () => {
  it("summarises the run", () => {
    const stats = new RunStats();
    const q = { ...lane };
    stats.record(q, score({ streakAfter: 1 }));
    stats.record(q, score({ streakAfter: 2 }));
    stats.record(q, score({ correct: false, streakAfter: 0, total: -10 }));
    const text = describeGameOver(250, stats);
    expect(text).toContain("Skor 250");
    expect(text).toContain("3 soal, 2 benar, 67 persen");
    expect(text).toContain("Beruntun terbaik 2");
  });

  it("copes with a run that had no questions", () => {
    const text = describeGameOver(40, new RunStats());
    expect(text).toContain("Skor 40");
    expect(text).not.toContain("soal,");
  });
});
