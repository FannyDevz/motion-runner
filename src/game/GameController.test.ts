import { describe, expect, it } from "vitest";
import { gameConfig } from "../config/gameConfig";
import type { Lane, Movement, MovementEvent } from "../movement/MovementTypes";
import { GameController } from "./GameController";
import { GameManager } from "./GameManager";

const input = gameConfig.input;

function event(movement: Movement, confidence = 0.9): MovementEvent {
  return { movement, confidence, timestamp: 0 };
}

function setup(lane: Lane | null = null) {
  let clock = 0;
  let standing: Lane | null = lane;
  const game = new GameManager(gameConfig.runner, () => 0.5);
  const controller = new GameController(game, input, () => standing, () => clock);
  return {
    game,
    controller,
    advance: (ms: number) => void (clock += ms),
    standIn: (l: Lane | null) => void (standing = l),
  };
}

/** Crash the player so the game reaches GAME_OVER. */
function crash(game: GameManager): void {
  game.obstacles.push({ id: 1, kind: "BARRIER", lane: game.player.lane, progress: 1, passed: false });
  game.update(16);
}

describe("GameController", () => {
  it("forwards movements to the game while running", () => {
    const { game, controller } = setup();
    game.start();
    controller.handleMovement(event("LEFT"));
    expect(game.player.lane).toBe("LEFT");
    controller.handleMovement(event("JUMP"));
    game.update(gameConfig.runner.player.jumpDurationMs / 2);
    expect(game.player.isAirborne).toBe(true);
  });

  it("ignores low-confidence events", () => {
    const { game, controller } = setup();
    game.start();
    controller.handleMovement(event("LEFT", input.minMovementConfidence - 0.01));
    expect(game.player.lane).toBe("CENTER");
  });

  it("starts the game from READY with a jump", () => {
    const { game, controller } = setup();
    controller.handleMovement(event("LEFT"));
    expect(game.state).toBe("READY");
    controller.handleMovement(event("JUMP"));
    expect(game.state).toBe("RUNNING");
  });

  it("does not start on a low-confidence jump", () => {
    const { game, controller } = setup();
    controller.handleMovement(event("JUMP", 0.2));
    expect(game.state).toBe("READY");
  });

  it("does not start with a jump when startWithJump is disabled", () => {
    const game = new GameManager(gameConfig.runner, () => 0.5);
    const controller = new GameController(game, { ...input, startWithJump: false }, () => null, () => 0);
    controller.handleMovement(event("JUMP"));
    expect(game.state).toBe("READY");
  });

  it("puts the player in the lane the person is standing in when the run starts", () => {
    const { game, controller } = setup("RIGHT");
    controller.handleMovement(event("JUMP"));
    expect(game.state).toBe("RUNNING");
    expect(game.player.lane).toBe("RIGHT");
  });

  it("keeps the default lane when the person is not tracked", () => {
    const { game, controller } = setup(null);
    controller.handleMovement(event("JUMP"));
    expect(game.player.lane).toBe("CENTER");
  });

  it("ignores a restart gesture during the cooldown, then allows it", () => {
    const { game, controller, advance } = setup();
    game.start();
    crash(game);
    expect(game.state).toBe("GAME_OVER");

    advance(input.restartCooldownMs - 100);
    controller.handleMovement(event("JUMP"));
    expect(game.state).toBe("GAME_OVER");

    advance(200);
    controller.handleMovement(event("JUMP"));
    expect(game.state).toBe("RUNNING");
  });

  it("only restarts on a jump, not on lane or crouch movements", () => {
    const { game, controller, advance } = setup();
    game.start();
    crash(game);
    advance(input.restartCooldownMs + 1);
    controller.handleMovement(event("LEFT"));
    controller.handleMovement(event("CROUCH"));
    expect(game.state).toBe("GAME_OVER");
  });
});
