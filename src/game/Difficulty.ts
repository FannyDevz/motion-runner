import type { DifficultyConfig } from "../config/gameConfig";
import { DIFFICULTIES, type Difficulty } from "../questions";

/** Difficulty to ask next, given how many questions the player has answered correctly this run. */
export function targetDifficulty(correctCount: number, config: DifficultyConfig): Difficulty {
  if (config.mode === "fixed") return config.fixed;
  if (correctCount >= config.thresholds.HARD) return "HARD";
  if (correctCount >= config.thresholds.MEDIUM) return "MEDIUM";
  return "EASY";
}

/**
 * Difficulties ordered by closeness to `target` (target first, then nearer ones;
 * on a tie the easier one comes first). Used to fall back gracefully when no
 * questions of the target difficulty are left.
 */
export function difficultiesByCloseness(target: Difficulty): Difficulty[] {
  const targetIndex = DIFFICULTIES.indexOf(target);
  return [...DIFFICULTIES].sort((a, b) => {
    const da = Math.abs(DIFFICULTIES.indexOf(a) - targetIndex);
    const db = Math.abs(DIFFICULTIES.indexOf(b) - targetIndex);
    return da - db || DIFFICULTIES.indexOf(a) - DIFFICULTIES.indexOf(b);
  });
}
