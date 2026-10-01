import { describe, expect, it } from "vitest";
import { gameConfig, type RunnerConfig } from "../config/gameConfig";
import type { AnswerResult, RawQuestion } from "../questions";
import { QuestionBank } from "../questions";
import { GameManager } from "./GameManager";
import type { GameState } from "./GameState";
import { QuestionManager } from "./QuestionManager";
import { selection } from "./testing/selection";

const FRAME_MS = 16;
const sm = gameConfig.runner.slowMotion;
const mapping = { laneOrder: gameConfig.runner.questions.laneOrder };

const laneQ: RawQuestion = {
  id: "lane-q",
  text: "Which animal is a mammal?",
  type: "LANE",
  answers: [{ text: "Chicken" }, { text: "Cat", correct: true }, { text: "Fish" }], // correct = B = CENTER
};
const moveQ: RawQuestion = {
  id: "move-q",
  text: "Overhead obstacle?",
  type: "MOVEMENT",
  answers: [
    { text: "Jump", action: "JUMP" },
    { text: "Crouch", action: "CROUCH", correct: true },
  ],
};

function config(runner: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    ...gameConfig.runner,
    questions: { ...gameConfig.runner.questions, everyNObstacles: 1 },
    ...runner,
  };
}

/** random() = 0 → obstacles are LEFT-lane barriers, harmless to a player in CENTER or RIGHT. */
const harmless = (): number => 0;

function setup(raw: RawQuestion, cfg: RunnerConfig = config()) {
  const bank = QuestionBank.fromData([raw], mapping);
  const game = new GameManager(cfg, harmless, new QuestionManager(bank, selection(), harmless));
  const states: GameState[] = [];
  const answers: AnswerResult[] = [];
  game.on("stateChange", ({ to }) => states.push(to));
  game.on("questionAnswered", ({ result }) => answers.push(result));
  game.start();
  return { game, states, answers };
}

function step(game: GameManager, ms: number): void {
  for (let t = 0; t < ms; t += FRAME_MS) game.update(FRAME_MS);
}

function runUntil(game: GameManager, done: () => boolean, maxMs = 60000): number {
  let elapsed = 0;
  while (elapsed < maxMs && !done()) {
    game.update(FRAME_MS);
    elapsed += FRAME_MS;
  }
  return elapsed;
}

const inState = (game: GameManager, state: GameState) => (): boolean => game.state === state;

describe("question sequence", () => {
  it("follows RUNNING → SLOW_MOTION → QUESTION → WAITING_FOR_MOVEMENT → RESUMING → RUNNING", () => {
    const { game, states } = setup(laneQ);
    runUntil(game, () => states.includes("RESUMING") && game.state === "RUNNING");
    expect(states).toEqual(["RUNNING", "SLOW_MOTION", "QUESTION", "WAITING_FOR_MOVEMENT", "RESUMING", "RUNNING"]);
  });

  it("warns when the gate appears, before slow motion starts", () => {
    const { game } = setup(laneQ);
    const order: string[] = [];
    game.on("questionWarning", () => order.push(`warning@${game.state}`));
    game.on("stateChange", ({ to }) => to === "SLOW_MOTION" && order.push("slow"));
    runUntil(game, inState(game, "QUESTION"));
    expect(order).toEqual(["warning@RUNNING", "slow"]);
  });

  it("only shows the question once slow motion has settled", () => {
    const { game } = setup(laneQ);
    let started = false;
    game.on("questionStarted", () => (started = true));
    runUntil(game, inState(game, "SLOW_MOTION"));
    expect(started).toBe(false);
    runUntil(game, inState(game, "QUESTION"));
    expect(started).toBe(true);
    expect(game.timeScale).toBeCloseTo(sm.slowFactor, 5);
  });

  it("holds the question for the reading time before collecting answers", () => {
    const { game } = setup(laneQ);
    runUntil(game, inState(game, "QUESTION"));
    const elapsed = runUntil(game, inState(game, "WAITING_FOR_MOVEMENT"));
    expect(elapsed).toBeGreaterThanOrEqual(sm.readMs - FRAME_MS);
    expect(elapsed).toBeLessThanOrEqual(sm.readMs + 2 * FRAME_MS);
  });
});

describe("time scale", () => {
  it("is 1 during normal play", () => {
    const { game } = setup(laneQ);
    step(game, 200);
    expect(game.timeScale).toBe(1);
  });

  it("eases down monotonically, holds, then eases back up", () => {
    const { game } = setup(laneQ);
    const trace: Array<[GameState, number]> = [];
    runUntil(game, () => {
      trace.push([game.state, game.timeScale]);
      return game.state === "RUNNING" && trace.some(([s]) => s === "RESUMING");
    });

    const during = (state: GameState) => trace.filter(([s]) => s === state).map(([, v]) => v);
    const down = during("SLOW_MOTION");
    const up = during("RESUMING");

    expect(down.every((v, i) => i === 0 || v <= down[i - 1] + 1e-9)).toBe(true);
    expect(up.every((v, i) => i === 0 || v >= up[i - 1] - 1e-9)).toBe(true);
    expect(during("QUESTION").every((v) => Math.abs(v - sm.slowFactor) < 1e-9)).toBe(true);
    expect(during("WAITING_FOR_MOVEMENT").every((v) => Math.abs(v - sm.slowFactor) < 1e-9)).toBe(true);
    expect(trace.every(([, v]) => v >= sm.slowFactor - 1e-9 && v <= 1 + 1e-9)).toBe(true);
    expect(game.timeScale).toBe(1);
  });

  it("slows the gate relative to real time", () => {
    const { game } = setup(laneQ);
    runUntil(game, gateAppears(game));
    const before = game.gate?.progress ?? 0;
    step(game, 100);
    const normalRate = (game.gate?.progress ?? 0) - before;

    runUntil(game, inState(game, "QUESTION"));
    const start = game.gate?.progress ?? 0;
    step(game, 100);
    const slowRate = (game.gate?.progress ?? 0) - start;
    expect(slowRate).toBeLessThan(normalRate * 0.5);
  });

  it("does not slow the player's own jump", () => {
    const { game } = setup(laneQ);
    runUntil(game, inState(game, "QUESTION"));
    game.handleMovement("JUMP");
    step(game, gameConfig.runner.player.jumpDurationMs + 2 * FRAME_MS);
    expect(game.player.jumpHeight).toBe(0);
  });

  it("does not advance difficulty (elapsed time) as fast during slow motion", () => {
    const { game } = setup(laneQ);
    runUntil(game, inState(game, "QUESTION"));
    const before = game.elapsedMs;
    step(game, 1000);
    expect(game.elapsedMs - before).toBeLessThan(1000 * sm.slowFactor * 1.5);
  });
});

const gateAppears = (game: GameManager) => (): boolean => game.gate !== null;

describe("collecting the answer", () => {
  it("MOVEMENT: locks in shortly after the last answer movement", () => {
    const { game, answers } = setup(moveQ);
    runUntil(game, inState(game, "WAITING_FOR_MOVEMENT"));
    game.handleMovement("CROUCH");
    const waited = runUntil(game, () => answers.length > 0);
    expect(waited).toBeGreaterThanOrEqual(sm.movementLockInMs - FRAME_MS);
    expect(waited).toBeLessThanOrEqual(sm.movementLockInMs + 2 * FRAME_MS);
    expect(answers[0]).toMatchObject({ correct: true, actualMovement: "CROUCH" });
  });

  it("MOVEMENT: a newer movement within the lock-in replaces the earlier one", () => {
    const { game, answers } = setup(moveQ);
    runUntil(game, inState(game, "WAITING_FOR_MOVEMENT"));
    game.handleMovement("JUMP");
    step(game, sm.movementLockInMs / 2);
    game.handleMovement("CROUCH");
    runUntil(game, () => answers.length > 0);
    expect(answers[0]).toMatchObject({ actualMovement: "CROUCH", correct: true });
  });

  it("MOVEMENT: a movement made while the question is still being read counts", () => {
    const { game, answers } = setup(moveQ);
    runUntil(game, inState(game, "QUESTION"));
    game.handleMovement("CROUCH");
    runUntil(game, () => answers.length > 0);
    expect(answers[0].correct).toBe(true);
  });

  it("MOVEMENT: a movement before slow motion is not part of the answer", () => {
    const { game, answers } = setup(moveQ);
    runUntil(game, gateAppears(game));
    expect(game.state).toBe("RUNNING");
    game.handleMovement("CROUCH");
    runUntil(game, () => answers.length > 0);
    expect(answers[0]).toMatchObject({ actualMovement: null, correct: false });
  });

  it("MOVEMENT: with no response, the window runs out and the answer is judged as none", () => {
    const { game, answers } = setup(moveQ);
    runUntil(game, inState(game, "WAITING_FOR_MOVEMENT"));
    const waited = runUntil(game, () => answers.length > 0);
    expect(waited).toBeGreaterThanOrEqual(sm.responseWindowMs - FRAME_MS);
    expect(waited).toBeLessThanOrEqual(sm.responseWindowMs + 2 * FRAME_MS);
    expect(answers[0]).toMatchObject({ selectedAnswerId: null, actualMovement: null, correct: false });
  });

  it("LANE: locks in once the player has stood in one lane long enough", () => {
    const { game, answers } = setup(laneQ);
    runUntil(game, inState(game, "WAITING_FOR_MOVEMENT"));
    const waited = runUntil(game, () => answers.length > 0);
    expect(waited).toBeGreaterThanOrEqual(sm.laneLockInMs - FRAME_MS);
    expect(waited).toBeLessThanOrEqual(sm.laneLockInMs + 2 * FRAME_MS);
    expect(answers[0].correct).toBe(true);
  });

  it("LANE: changing lane restarts the lock-in timer", () => {
    const { game, answers } = setup(laneQ);
    runUntil(game, inState(game, "WAITING_FOR_MOVEMENT"));
    step(game, sm.laneLockInMs - 300);
    game.handleMovement("RIGHT");
    const waited = runUntil(game, () => answers.length > 0);
    expect(waited).toBeGreaterThanOrEqual(sm.laneLockInMs - FRAME_MS);
    expect(answers[0]).toMatchObject({ actualMovement: "RIGHT", selectedAnswerId: "C", correct: false });
  });

  it("LANE: is judged by the lane at the end, not the lane at the start", () => {
    const { game, answers } = setup(laneQ);
    game.handleMovement("RIGHT"); // not LEFT: that is where the harmless test obstacles run
    runUntil(game, inState(game, "WAITING_FOR_MOVEMENT"));
    game.handleMovement("CENTER");
    runUntil(game, () => answers.length > 0);
    expect(answers[0].correct).toBe(true);
  });

  it("reports the time left in the answer window only while waiting", () => {
    const { game } = setup(moveQ);
    expect(game.responseTimeLeft).toBeNull();
    runUntil(game, inState(game, "QUESTION"));
    expect(game.responseTimeLeft).toBeNull();
    runUntil(game, inState(game, "WAITING_FOR_MOVEMENT"));
    const a = game.responseTimeLeft ?? 0;
    step(game, 1000);
    const b = game.responseTimeLeft ?? 0;
    expect(a).toBeGreaterThan(0.9);
    expect(b).toBeLessThan(a);
    expect(b).toBeGreaterThan(0);
  });
});

describe("gate behaviour", () => {
  it("waits for the road to clear before a question appears", () => {
    const { game } = setup(laneQ);
    let sawGateWithHazard = false;
    runUntil(game, () => {
      if (game.gate && game.obstacles.some((o) => !o.passed)) sawGateWithHazard = true;
      return game.state === "QUESTION";
    });
    expect(sawGateWithHazard).toBe(false);
  });

  it("never moves past the hold line while the question is open", () => {
    const fast = config({ speed: { ...gameConfig.runner.speed, accelerationPerSecond: 1000, maxMultiplier: 2 } });
    const { game } = setup(laneQ, fast);
    let maxProgress = 0;
    runUntil(game, () => {
      maxProgress = Math.max(maxProgress, game.gate?.progress ?? 0);
      return game.state === "RESUMING";
    });
    expect(maxProgress).toBeLessThanOrEqual(sm.holdProgress + 1e-9);
    expect(maxProgress).toBeGreaterThan(sm.slowStartProgress);
  });

  it("carries on past the player after being answered, then disappears", () => {
    const { game, answers } = setup(laneQ);
    runUntil(game, () => answers.length > 0);
    expect(game.gate).toBeNull();
    expect(game.exitingGate?.result.correct).toBe(true);
    const progress = game.exitingGate?.progress ?? 0;
    step(game, 200);
    expect(game.exitingGate?.progress ?? Infinity).toBeGreaterThan(progress);
    runUntil(game, () => game.exitingGate === null, 10000);
    expect(game.exitingGate).toBeNull();
  });
});

describe("pausing during a question", () => {
  it.each(["QUESTION", "WAITING_FOR_MOVEMENT"] as const)("resumes into %s with timers frozen", (state) => {
    const { game, answers } = setup(moveQ);
    runUntil(game, inState(game, state));
    step(game, 200);
    const left = game.responseTimeLeft;
    const scale = game.timeScale;

    game.pause();
    expect(game.state).toBe("PAUSED");
    step(game, 20000);
    expect(answers).toHaveLength(0);

    game.resume();
    expect(game.state).toBe(state);
    expect(game.timeScale).toBe(scale);
    expect(game.responseTimeLeft).toBe(left);
  });

  it("can be paused and resumed from RESUMING and SLOW_MOTION too", () => {
    const { game } = setup(laneQ);
    runUntil(game, inState(game, "SLOW_MOTION"));
    game.pause();
    game.resume();
    expect(game.state).toBe("SLOW_MOTION");
  });

  it("ignores movement while paused", () => {
    const { game } = setup(laneQ);
    runUntil(game, inState(game, "QUESTION"));
    game.pause();
    game.handleMovement("RIGHT");
    expect(game.player.lane).toBe("CENTER");
  });
});
