import type { QuestionsConfig } from "../config/gameConfig";
import type { RunStats } from "../game/RunStats";
import type { ScoreBreakdown } from "../game/Scoring";
import type { AnswerResult, Question } from "../questions";
import { answerLetter } from "../questions";
import { strings } from "./strings";

/**
 * Plain-text descriptions of what happens on screen, for screen readers (the canvas is
 * not readable). Pure functions so they can be tested and the wording changed in one place.
 */

/** "Soal Matematika, Sedang. Berapa hasil 12 × 3? A, 32, geser ke Kiri. B, 38, …" */
export function describeQuestion(question: Question, config: QuestionsConfig): string {
  const category = config.categoryLabels[question.category] ?? question.category;
  const level = config.text.difficulty[question.difficulty];
  const how = question.type === "LANE" ? "geser ke" : "lakukan";
  const options = question.answers
    .map((a, i) => `${answerLetter(i)}, ${a.text}, ${how} ${strings.movements[a.action]}`)
    .join(". ");
  return `Soal ${category}, ${level}. ${question.text} ${options}.`;
}

export function describeResult(question: Question, result: AnswerResult, score: ScoreBreakdown, config: QuestionsConfig): string {
  const { text } = config;
  if (result.correct) {
    const points = score.total > 0 ? ` Tambah ${score.total} poin.` : "";
    const streak = score.streakAfter >= 2 ? ` Beruntun ${score.streakAfter}.` : "";
    return `${text.correct}${points}${streak}`;
  }
  const heading = result.selectedAnswerId === null ? text.noAnswer : text.incorrect;
  const correct = question.answers.find((a) => a.correct);
  const answer = correct ? ` ${text.correctAnswerPrefix} ${correct.text}.` : "";
  const penalty = score.total < 0 ? ` Kurang ${-score.total} poin.` : "";
  return `${heading}.${answer}${penalty}`;
}

export function describeGameOver(score: number, stats: RunStats): string {
  const base = `${strings.game.gameOverTitle}. ${strings.game.score} ${score}.`;
  if (stats.asked === 0) return `${base} ${strings.game.restart}.`;
  const percent = Math.round(stats.accuracy * 100);
  return `${base} ${stats.asked} soal, ${stats.correct} benar, ${percent} persen. Beruntun terbaik ${stats.bestStreak}. ${strings.game.restart}.`;
}
