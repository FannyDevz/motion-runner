export type GameState =
  | "READY"
  | "RUNNING"
  | "QUESTION"
  | "SLOW_MOTION"
  | "WAITING_FOR_MOVEMENT"
  | "RESUMING"
  | "GAME_OVER"
  | "PAUSED";

/**
 * Allowed transitions. The question/slow-motion states are declared now so the
 * state machine does not need reshaping in later phases.
 */
const TRANSITIONS: Readonly<Record<GameState, readonly GameState[]>> = {
  READY: ["RUNNING"],
  RUNNING: ["SLOW_MOTION", "PAUSED", "GAME_OVER"],
  SLOW_MOTION: ["QUESTION", "PAUSED", "GAME_OVER"],
  QUESTION: ["WAITING_FOR_MOVEMENT", "PAUSED", "GAME_OVER"],
  WAITING_FOR_MOVEMENT: ["RESUMING", "PAUSED", "GAME_OVER"],
  RESUMING: ["RUNNING", "PAUSED", "GAME_OVER"],
  // Resuming returns to whichever state the game was paused from.
  PAUSED: ["RUNNING", "SLOW_MOTION", "QUESTION", "WAITING_FOR_MOVEMENT", "RESUMING", "GAME_OVER"],
  GAME_OVER: ["READY"],
};

export function canTransition(from: GameState, to: GameState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** States in which the world is simulated (everything except READY, PAUSED and GAME_OVER). */
export const ACTIVE_STATES: readonly GameState[] = ["RUNNING", "SLOW_MOTION", "QUESTION", "WAITING_FOR_MOVEMENT", "RESUMING"];

export function isActive(state: GameState): boolean {
  return ACTIVE_STATES.includes(state);
}
