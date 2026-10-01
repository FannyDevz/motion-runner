import type { ScoringConfig } from "../config/gameConfig";
import type { AnswerResult, Question } from "../questions";

/** How the points for one answered question were made up. */
export interface ScoreBreakdown {
  correct: boolean;
  /** Base points for the question's difficulty (0 when wrong). */
  base: number;
  /** Streak multiplier applied to the base (1 when wrong or no streak). */
  streakMultiplier: number;
  /** Extra points for deciding early (0 when wrong). */
  speedBonus: number;
  /** Points added to the score (negative for a penalty). */
  total: number;
  streakBefore: number;
  streakAfter: number;
}

/**
 * Score one answered question.
 * @param streakBefore consecutive correct answers before this one
 * @param timeLeftFraction 0..1, how much of the answer window was left when the player decided
 */
export function scoreAnswer(
  question: Question,
  result: AnswerResult,
  streakBefore: number,
  timeLeftFraction: number,
  config: ScoringConfig,
): ScoreBreakdown {
  if (!result.correct) {
    return {
      correct: false,
      base: 0,
      streakMultiplier: 1,
      speedBonus: 0,
      total: config.incorrectPoints,
      streakBefore,
      streakAfter: 0,
    };
  }

  const base = config.basePoints[question.difficulty];
  const streakMultiplier = Math.min(config.maxStreakMultiplier, 1 + config.streakStep * streakBefore);
  const fraction = Math.min(1, Math.max(0, timeLeftFraction));
  const speedBonus = Math.round(config.maxSpeedBonus * fraction);
  return {
    correct: true,
    base,
    streakMultiplier,
    speedBonus,
    total: Math.round(base * streakMultiplier) + speedBonus,
    streakBefore,
    streakAfter: streakBefore + 1,
  };
}
