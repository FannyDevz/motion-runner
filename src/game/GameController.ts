import type { InputConfig } from "../config/gameConfig";
import type { Lane, MovementEvent } from "../movement/MovementTypes";
import type { GameManager } from "./GameManager";

/**
 * Bridges movement events to the game. Applies the game-side rules for
 * reacting to input: ignore low-confidence events, start/restart with a jump
 * gesture, and sync the player's lane to where the person is standing when a
 * run begins (lane events only fire on change, so a run could otherwise start
 * with the player in the wrong lane).
 */
export class GameController {
  private gameOverAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly game: GameManager,
    private readonly config: InputConfig,
    /** Lane the person is currently standing in, if tracked. */
    private readonly currentLane: () => Lane | null,
    private readonly now: () => number = () => performance.now(),
  ) {
    game.on("stateChange", ({ to }) => {
      if (to === "GAME_OVER") this.gameOverAt = this.now();
      if (to === "RUNNING") this.syncLane();
    });
  }

  handleMovement(event: MovementEvent): void {
    if (event.confidence < this.config.minMovementConfidence) return;

    const { state } = this.game;
    if (state === "READY" || state === "GAME_OVER") {
      if (event.movement === "JUMP" && this.config.startWithJump && this.canRestart(state)) this.game.start();
      return;
    }
    this.game.handleMovement(event.movement);
  }

  private canRestart(state: "READY" | "GAME_OVER"): boolean {
    return state === "READY" || this.now() - this.gameOverAt >= this.config.restartCooldownMs;
  }

  private syncLane(): void {
    const lane = this.currentLane();
    if (lane) this.game.handleMovement(lane);
  }
}
