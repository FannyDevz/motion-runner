import { describe, expect, it } from "vitest";
import { gameConfig } from "../config/gameConfig";
import { canTransition } from "./GameState";
import { GameManager } from "./GameManager";
import { collides, type Obstacle } from "./Obstacle";
import { Player } from "./Player";

const cfg = gameConfig.runner;
const FRAME_MS = 16;

/** Deterministic RNG that cycles through the given values. */
function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

function obstacle(partial: Partial<Obstacle>): Obstacle {
  return { id: 1, kind: "BARRIER", lane: "CENTER", progress: 1, passed: false, ...partial };
}

function run(game: GameManager, ms: number): void {
  for (let t = 0; t < ms; t += FRAME_MS) game.update(FRAME_MS);
}

/** First spawn: lane picked by first random, kind by the second. 0 → LEFT, 0.5 → CENTER, 0.9 → RIGHT. */
const spawnLeftBarrier = (): (() => number) => sequence(0, 0, 0);

describe("GameState transitions", () => {
  it("allows the planned flow and rejects shortcuts", () => {
    expect(canTransition("READY", "RUNNING")).toBe(true);
    expect(canTransition("RUNNING", "SLOW_MOTION")).toBe(true);
    expect(canTransition("RUNNING", "QUESTION")).toBe(false);
    expect(canTransition("GAME_OVER", "RUNNING")).toBe(false);
    expect(canTransition("GAME_OVER", "READY")).toBe(true);
  });
});

describe("Player", () => {
  it("jumps along an arc and returns to the ground", () => {
    const p = new Player(cfg.player);
    p.jump();
    p.update(cfg.player.jumpDurationMs / 2);
    expect(p.jumpHeight).toBeCloseTo(1);
    expect(p.isAirborne).toBe(true);
    p.update(cfg.player.jumpDurationMs);
    expect(p.jumpHeight).toBe(0);
    expect(p.isAirborne).toBe(false);
  });

  it("is not airborne right at takeoff or landing", () => {
    const p = new Player(cfg.player);
    p.jump();
    p.update(cfg.player.jumpDurationMs * 0.05);
    expect(p.isAirborne).toBe(false);
  });

  it("crouches for the configured time", () => {
    const p = new Player(cfg.player);
    p.crouch();
    expect(p.isCrouching).toBe(true);
    p.update(cfg.player.crouchHoldMs + 1);
    expect(p.isCrouching).toBe(false);
  });

  it("cannot jump while crouching or crouch while jumping", () => {
    const p = new Player(cfg.player);
    p.crouch();
    p.jump();
    expect(p.jumpHeight).toBe(0);
    const q = new Player(cfg.player);
    q.jump();
    q.update(cfg.player.jumpDurationMs / 2);
    q.crouch();
    expect(q.isCrouching).toBe(false);
  });
});

describe("collision", () => {
  const hit = cfg.collision;

  it("only collides inside the hit zone", () => {
    const p = new Player(cfg.player);
    expect(collides(obstacle({ progress: 0.5 }), p, hit)).toBe(false);
    expect(collides(obstacle({ progress: 1 }), p, hit)).toBe(true);
    expect(collides(obstacle({ progress: 1.2 }), p, hit)).toBe(false);
  });

  it("does not collide when in a different lane", () => {
    const p = new Player(cfg.player);
    p.moveTo("LEFT");
    expect(collides(obstacle({ lane: "CENTER" }), p, hit)).toBe(false);
  });

  it("a low hurdle is cleared only while airborne", () => {
    const p = new Player(cfg.player);
    expect(collides(obstacle({ kind: "LOW" }), p, hit)).toBe(true);
    p.jump();
    p.update(cfg.player.jumpDurationMs / 2);
    expect(collides(obstacle({ kind: "LOW" }), p, hit)).toBe(false);
  });

  it("an overhead bar is cleared only while crouching", () => {
    const p = new Player(cfg.player);
    expect(collides(obstacle({ kind: "HIGH" }), p, hit)).toBe(true);
    p.crouch();
    expect(collides(obstacle({ kind: "HIGH" }), p, hit)).toBe(false);
  });

  it("jumping or crouching never avoids a barrier", () => {
    const p = new Player(cfg.player);
    p.jump();
    p.update(cfg.player.jumpDurationMs / 2);
    expect(collides(obstacle({ kind: "BARRIER" }), p, hit)).toBe(true);
  });
});

describe("GameManager", () => {
  it("starts in READY and does nothing until started", () => {
    const game = new GameManager(cfg, spawnLeftBarrier());
    run(game, 5000);
    expect(game.state).toBe("READY");
    expect(game.obstacles).toHaveLength(0);
  });

  it("spawns obstacles while running", () => {
    const game = new GameManager(cfg, sequence(0.5));
    game.start();
    run(game, cfg.spawn.maxIntervalMs + 100);
    expect(game.obstacles.length).toBeGreaterThan(0);
  });

  it("ends the game when an obstacle reaches the player unavoided", () => {
    const game = new GameManager(cfg, sequence(0.5, 0, 0.5));
    game.start();
    run(game, 10000);
    expect(game.state).toBe("GAME_OVER");
  });

  it("survives by moving out of the barrier's lane and scores the dodge", () => {
    // Obstacles spawn in the LEFT lane as barriers (lane roll 0, kind roll 0).
    const game = new GameManager(cfg, spawnLeftBarrier());
    game.start();
    game.handleMovement("RIGHT");
    run(game, 8000);
    expect(game.state).toBe("RUNNING");
    expect(game.score).toBeGreaterThan(0);
  });

  it("emits collision and stateChange events", () => {
    const game = new GameManager(cfg, sequence(0.5, 0, 0.5));
    const changes: string[] = [];
    let collisions = 0;
    game.on("stateChange", (e) => changes.push(`${e.from}>${e.to}`));
    game.on("collision", () => collisions++);
    game.start();
    run(game, 10000);
    expect(changes).toEqual(["READY>RUNNING", "RUNNING>GAME_OVER"]);
    expect(collisions).toBe(1);
  });

  it("ignores movement unless running", () => {
    const game = new GameManager(cfg, spawnLeftBarrier());
    game.handleMovement("LEFT");
    expect(game.player.lane).toBe("CENTER");
  });

  it("maps movements to player actions", () => {
    const game = new GameManager(cfg, spawnLeftBarrier());
    game.start();
    game.handleMovement("LEFT");
    expect(game.player.lane).toBe("LEFT");
    game.handleMovement("JUMP");
    game.update(cfg.player.jumpDurationMs / 2);
    expect(game.player.isAirborne).toBe(true);
  });

  it("freezes while paused and resumes", () => {
    const game = new GameManager(cfg, spawnLeftBarrier());
    game.start();
    run(game, 500);
    const t = game.elapsedMs;
    game.pause();
    run(game, 2000);
    expect(game.elapsedMs).toBe(t);
    game.resume();
    run(game, 100);
    expect(game.elapsedMs).toBeGreaterThan(t);
  });

  it("speeds up over time up to the cap", () => {
    const game = new GameManager(cfg, spawnLeftBarrier());
    game.start();
    expect(game.speedMultiplier).toBe(1);
    game.handleMovement("RIGHT");
    run(game, 20000);
    expect(game.speedMultiplier).toBeGreaterThan(1);
    expect(game.speedMultiplier).toBeLessThanOrEqual(cfg.speed.maxMultiplier);
  });

  it("restarts cleanly after game over", () => {
    const game = new GameManager(cfg, sequence(0.5, 0, 0.5));
    game.start();
    run(game, 10000);
    expect(game.state).toBe("GAME_OVER");
    game.start();
    expect(game.state).toBe("RUNNING");
    expect(game.obstacles).toHaveLength(0);
    expect(game.score).toBe(0);
    expect(game.elapsedMs).toBe(0);
  });
});

describe("playerAction events", () => {
  function started(): { game: GameManager; actions: string[] } {
    const game = new GameManager(cfg, spawnLeftBarrier());
    const actions: string[] = [];
    game.on("playerAction", (m) => actions.push(m));
    game.start();
    return { game, actions };
  }

  it("fires when the player changes lane, jumps or crouches", () => {
    const { game, actions } = started();
    game.handleMovement("RIGHT");
    game.handleMovement("JUMP");
    game.update(cfg.player.jumpDurationMs + 50);
    game.handleMovement("CROUCH");
    expect(actions).toEqual(["RIGHT", "JUMP", "CROUCH"]);
  });

  it("does not fire for a lane the player is already in", () => {
    const { game, actions } = started();
    game.handleMovement("CENTER");
    expect(actions).toEqual([]);
  });

  it("does not fire for a jump that is ignored mid-jump or while crouching", () => {
    const { game, actions } = started();
    game.handleMovement("JUMP");
    game.handleMovement("JUMP");
    expect(actions).toEqual(["JUMP"]);

    const other = started();
    other.game.handleMovement("CROUCH");
    other.game.handleMovement("JUMP");
    expect(other.actions).toEqual(["CROUCH"]);
  });

  it("does not fire again for a crouch that merely extends the current one", () => {
    const { game, actions } = started();
    game.handleMovement("CROUCH");
    game.handleMovement("CROUCH");
    expect(actions).toEqual(["CROUCH"]);
    expect(game.player.isCrouching).toBe(true);
  });

  it("does not fire when the game is not running", () => {
    const game = new GameManager(cfg, spawnLeftBarrier());
    const actions: string[] = [];
    game.on("playerAction", (m) => actions.push(m));
    game.handleMovement("LEFT");
    expect(actions).toEqual([]);
  });
});
