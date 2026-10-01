import { describe, expect, it } from "vitest";
import { gameConfig, type RunnerConfig } from "../config/gameConfig";
import type { AnswerResult, RawQuestion } from "../questions";
import { QuestionBank } from "../questions";
import { GameManager } from "./GameManager";
import type { GameState } from "./GameState";
import { QuestionManager } from "./QuestionManager";
import { selection } from "./testing/selection";

const FRAME_MS = 16;
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

function config(overrides: Partial<RunnerConfig["questions"]> = {}): RunnerConfig {
  return { ...gameConfig.runner, questions: { ...gameConfig.runner.questions, everyNObstacles: 1, ...overrides } };
}

/**
 * random() = 0 → obstacles always spawn as BARRIERs in the LEFT lane, so a player
 * standing in CENTER or RIGHT is never hit and the question is the only thing that matters.
 */
const harmless = (): number => 0;

function setup(raw: RawQuestion[], cfg: RunnerConfig = config()) {
  const bank = QuestionBank.fromData(raw, mapping);
  const manager = new QuestionManager(bank, selection(), harmless);
  const game = new GameManager(cfg, harmless, manager);
  const answers: AnswerResult[] = [];
  game.on("questionAnswered", ({ result }) => answers.push(result));
  game.start();
  return { game, answers, manager };
}

function runUntil(game: GameManager, done: () => boolean, maxMs = 60000): void {
  for (let t = 0; t < maxMs && !done(); t += FRAME_MS) game.update(FRAME_MS);
}

const gateAppears = (game: GameManager) => (): boolean => game.gate !== null;
const inState = (game: GameManager, state: GameState) => (): boolean => game.state === state;

/** Highest id among obstacles currently on the road (0 when there are none). */
const newestId = (game: GameManager): number => Math.max(0, ...game.obstacles.map((o) => o.id));

describe("question gates", () => {
  it("never appear without a QuestionManager", () => {
    const game = new GameManager(config(), harmless);
    game.start();
    runUntil(game, () => false, 12000);
    expect(game.gate).toBeNull();
  });

  it("never appear when questions are disabled", () => {
    const bank = QuestionBank.fromData([laneQ], mapping);
    const game = new GameManager(config({ enabled: false }), harmless, new QuestionManager(bank, selection()));
    game.start();
    runUntil(game, () => false, 12000);
    expect(game.gate).toBeNull();
  });

  it("replace every Nth obstacle and announce the question", () => {
    const { game } = setup([laneQ], config({ everyNObstacles: 2 }));
    const warned: string[] = [];
    const started: string[] = [];
    let dodged = 0;
    game.on("questionWarning", (s) => warned.push(s.question.id));
    game.on("questionStarted", (s) => started.push(s.question.id));
    game.on("obstacleDodged", () => dodged++);
    runUntil(game, gateAppears(game));
    expect(game.gate?.session.question.id).toBe("lane-q");
    // Two obstacles came first, and both have gone by.
    expect(dodged).toBe(2);
    runUntil(game, inState(game, "QUESTION"));
    expect(warned).toEqual(["lane-q"]);
    expect(started).toEqual(["lane-q"]);
  });

  it("pause obstacle spawning while a question is on its way", () => {
    const { game } = setup([laneQ]);
    runUntil(game, gateAppears(game));
    const idsAtStart = newestId(game);
    for (let t = 0; t < 2000; t += FRAME_MS) game.update(FRAME_MS);
    expect(game.gate).not.toBeNull();
    expect(newestId(game)).toBeLessThanOrEqual(idsAtStart);
  });

});

describe("answering with lanes", () => {
  it("is correct when the player stands in the correct answer's lane", () => {
    const { game, answers } = setup([laneQ]); // player starts in CENTER = B = correct
    runUntil(game, () => answers.length > 0);
    expect(answers[0]).toEqual({
      questionId: "lane-q",
      selectedAnswerId: "B",
      requiredMovement: "CENTER",
      actualMovement: "CENTER",
      correct: true,
    });
  });

  it("is incorrect in a wrong lane, judged where the player stands when it arrives", () => {
    const { game, answers } = setup([laneQ]);
    runUntil(game, gateAppears(game));
    game.handleMovement("RIGHT");
    runUntil(game, () => answers.length > 0);
    expect(answers[0]).toMatchObject({ selectedAnswerId: "C", requiredMovement: "CENTER", actualMovement: "RIGHT", correct: false });
  });

  it("uses the final lane, so the player can change their mind", () => {
    const { game, answers } = setup([laneQ]);
    runUntil(game, gateAppears(game));
    game.handleMovement("LEFT");
    game.handleMovement("CENTER");
    runUntil(game, () => answers.length > 0);
    expect(answers[0].correct).toBe(true);
  });

  it("follows a configurable answer mapping", () => {
    const bank = QuestionBank.fromData([laneQ], { laneOrder: ["RIGHT", "LEFT", "CENTER"] }); // B → LEFT
    const game = new GameManager(config(), harmless, new QuestionManager(bank, selection()));
    const answers: AnswerResult[] = [];
    game.on("questionAnswered", ({ result }) => answers.push(result));
    game.start();
    runUntil(game, gateAppears(game));
    game.handleMovement("LEFT");
    // Obstacles are in LEFT too; clear them so the player survives to answer.
    runUntil(game, () => (game.obstacles.length = 0, answers.length > 0));
    expect(answers[0]).toMatchObject({ requiredMovement: "LEFT", correct: true });
  });
});

describe("answering with movements", () => {
  it("is correct when the player performs the required movement", () => {
    const { game, answers } = setup([moveQ]);
    runUntil(game, inState(game, "WAITING_FOR_MOVEMENT"));
    game.handleMovement("CROUCH");
    runUntil(game, () => answers.length > 0);
    expect(answers[0]).toEqual({
      questionId: "move-q",
      selectedAnswerId: "B",
      requiredMovement: "CROUCH",
      actualMovement: "CROUCH",
      correct: true,
    });
  });

  it("is incorrect with the wrong movement", () => {
    const { game, answers } = setup([moveQ]);
    runUntil(game, inState(game, "WAITING_FOR_MOVEMENT"));
    game.handleMovement("JUMP");
    runUntil(game, () => answers.length > 0);
    expect(answers[0]).toMatchObject({ selectedAnswerId: "A", actualMovement: "JUMP", correct: false });
  });

  it("is incorrect, with no selection, when the player does nothing", () => {
    const { game, answers } = setup([moveQ]);
    runUntil(game, () => answers.length > 0);
    expect(answers[0]).toMatchObject({ selectedAnswerId: null, actualMovement: null, correct: false });
  });

  it("ignores lane movements as answers", () => {
    const { game, answers } = setup([moveQ]);
    runUntil(game, inState(game, "WAITING_FOR_MOVEMENT"));
    game.handleMovement("RIGHT");
    runUntil(game, () => answers.length > 0);
    expect(answers[0].actualMovement).toBeNull();
  });
});

describe("scoring and flow after a question", () => {
  it("adds points for a correct answer only", () => {
    const flat = { ...gameConfig.runner.questions.scoring, basePoints: { EASY: 500, MEDIUM: 500, HARD: 500 }, streakStep: 0, maxSpeedBonus: 0, incorrectPoints: 0 };
    const right = setup([laneQ], config({ scoring: flat }));
    runUntil(right.game, () => right.answers.length > 0);
    expect(right.game.score).toBeGreaterThanOrEqual(500);

    const wrong = setup([moveQ], config({ scoring: flat }));
    runUntil(wrong.game, () => wrong.answers.length > 0);
    expect(wrong.game.score).toBeLessThan(500);
  });

  it("never lets the score drop below zero", () => {
    const { game, answers } = setup([moveQ], config({ scoring: { ...gameConfig.runner.questions.scoring, incorrectPoints: -1000 } }));
    runUntil(game, () => answers.length > 0);
    expect(game.score).toBe(0);
  });

  it("clears the gate and keeps the game running after an answer", () => {
    const { game, answers } = setup([laneQ]);
    runUntil(game, () => answers.length > 0);
    expect(game.gate).toBeNull();
    expect(game.state).toBe("RESUMING");
    runUntil(game, inState(game, "RUNNING"));
    expect(game.state).toBe("RUNNING");
  });

  it("holds obstacles back for the configured gap, then resumes", () => {
    const { game, answers } = setup([laneQ]);
    runUntil(game, () => answers.length > 0);
    const lastId = newestId(game);
    const gap = gameConfig.runner.questions.gapAfterQuestionMs;

    for (let t = 0; t < gap - 100; t += FRAME_MS) game.update(FRAME_MS);
    expect(newestId(game)).toBeLessThanOrEqual(lastId);

    runUntil(game, () => newestId(game) > lastId, 2500);
    expect(newestId(game)).toBeGreaterThan(lastId);
  });

  it("asks a new question next and restarts cleanly after game over", () => {
    const { game, answers } = setup([laneQ, moveQ]);
    runUntil(game, () => answers.length >= 2);
    expect(answers.map((a) => a.questionId)).toEqual(["lane-q", "move-q"]);

    runUntil(game, gateAppears(game));
    game.obstacles.push({ id: 999, kind: "BARRIER", lane: game.player.lane, progress: 1, passed: false });
    game.update(FRAME_MS);
    expect(game.state).toBe("GAME_OVER");

    game.start();
    expect(game.gate).toBeNull();
    answers.length = 0;
    runUntil(game, () => answers.length > 0);
    expect(answers[0].questionId).toBe("lane-q"); // deck was reset
  });
});
