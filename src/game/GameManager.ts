import type { RunnerConfig } from "../config/gameConfig";
import type { Movement } from "../movement/MovementTypes";
import type { AnswerResult, Question, QuestionSession } from "../questions";
import { isLane } from "../questions";
import { Emitter } from "../utils/Emitter";
import { canTransition, isActive, type GameState } from "./GameState";
import { collides, type Obstacle, type ObstacleKind } from "./Obstacle";
import { LANES, Player } from "./Player";
import type { QuestionManager } from "./QuestionManager";
import { RunStats } from "./RunStats";
import { scoreAnswer, type ScoreBreakdown } from "./Scoring";

interface GameEvents extends Record<string, unknown> {
  stateChange: { from: GameState; to: GameState };
  obstacleDodged: Obstacle;
  collision: Obstacle;
  /** The player did something that took effect: changed lane, started a jump, or started a crouch. */
  playerAction: Movement;
  /** A question gate has appeared ahead; slow motion is about to begin. */
  questionWarning: QuestionSession;
  /** Slow motion has settled and the question is now shown. */
  questionStarted: QuestionSession;
  questionAnswered: { question: Question; result: AnswerResult; score: ScoreBreakdown };
}

/** A question travelling toward the player. */
export interface QuestionGate {
  /** Travel progress: 0 at spawn (horizon), 1 at the player line. */
  progress: number;
  session: QuestionSession;
}

/** A gate that has been answered and is carrying on past the player. */
export interface ExitingGate extends QuestionGate {
  result: AnswerResult;
}

export type Random = () => number;

const GATE_EXIT_PROGRESS = 1.2;
const OBSTACLE_REMOVE_PROGRESS = 1.3;
/** How soon to look again when a gate is due but obstacles are still on the road. */
const GATE_RETRY_MS = 100;

/** Smoothstep easing for time-scale ramps. */
function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * Game rules and simulation, free of any rendering. Owns the state machine,
 * player, obstacles, spawning, collision, score and the question sequence.
 * Consumes movement events (never raw pose landmarks) via handleMovement().
 *
 * Question sequence (durations in real time, world slowed by `timeScale`):
 *   RUNNING → SLOW_MOTION → QUESTION → WAITING_FOR_MOVEMENT → RESUMING → RUNNING
 */
export class GameManager extends Emitter<GameEvents> {
  readonly player: Player;
  readonly obstacles: Obstacle[] = [];
  /** Question results for the current run (for the HUD and the game-over summary). */
  readonly stats = new RunStats();

  private _state: GameState = "READY";
  private _score = 0;
  private _elapsedMs = 0;
  private spawnTimerMs = 0;
  private nextId = 1;
  private secondsScored = 0;
  private _gate: QuestionGate | null = null;
  private _exitingGate: ExitingGate | null = null;
  private spawnsSinceGate = 0;

  private _timeScale = 1;
  private pausedFrom: GameState = "RUNNING";
  /** Real time spent in the current state. */
  private phaseMs = 0;
  /** Real time since the current question's slow motion began. */
  private flowClockMs = 0;
  private warned = false;
  private lastResponseAt: number | null = null;
  private laneChangedAt = 0;
  private waitingStartedAt = 0;

  constructor(
    private readonly config: RunnerConfig,
    private readonly random: Random = Math.random,
    /** Optional. Without it the game has obstacles only. */
    private readonly questions: QuestionManager | null = null,
  ) {
    super();
    this.player = new Player(config.player);
    this.spawnTimerMs = this.nextSpawnDelay();
  }

  get state(): GameState {
    return this._state;
  }

  /** The question currently travelling toward the player, if any. */
  get gate(): QuestionGate | null {
    return this._gate;
  }

  /** The most recently answered gate, still passing the player (for visuals). */
  get exitingGate(): ExitingGate | null {
    return this._exitingGate;
  }

  get score(): number {
    return Math.floor(this._score);
  }

  /** Consecutive correct answers right now. */
  get streak(): number {
    return this.stats.streak;
  }

  get elapsedMs(): number {
    return this._elapsedMs;
  }

  /** World speed factor: 1 normally, eased down to slowMotion.slowFactor during a question. */
  get timeScale(): number {
    return this._timeScale;
  }

  /** Fraction of the answer window still left (1 → 0) while waiting for a response, otherwise null. */
  get responseTimeLeft(): number | null {
    if (this._state !== "WAITING_FOR_MOVEMENT") return null;
    return Math.max(0, 1 - this.phaseMs / this.config.slowMotion.responseWindowMs);
  }

  /** Current speed multiplier (grows with play time up to the configured cap). */
  get speedMultiplier(): number {
    const { accelerationPerSecond, maxMultiplier } = this.config.speed;
    return Math.min(maxMultiplier, 1 + accelerationPerSecond * (this._elapsedMs / 1000));
  }

  start(): void {
    if (this._state === "GAME_OVER") this.transition("READY");
    if (this._state === "READY") {
      this.resetRun();
      this.transition("RUNNING");
    }
  }

  pause(): void {
    if (!isActive(this._state)) return;
    this.pausedFrom = this._state;
    this.transition("PAUSED");
  }

  resume(): void {
    if (this._state === "PAUSED") this.transition(this.pausedFrom);
  }

  /** Translate a semantic movement into a player action. */
  handleMovement(movement: Movement): void {
    if (!isActive(this._state)) return;

    if (isLane(movement) && movement !== this.player.lane) this.laneChangedAt = this.flowClockMs;
    if (this.acceptingAnswers && this._gate?.session.recordMovement(movement)) this.lastResponseAt = this.flowClockMs;

    let took = false;
    switch (movement) {
      case "LEFT":
      case "CENTER":
      case "RIGHT":
        took = movement !== this.player.lane;
        this.player.moveTo(movement);
        break;
      case "JUMP":
        took = this.player.jump();
        break;
      case "CROUCH": {
        // Crouching again while already crouched only extends it: not a new action.
        const wasCrouching = this.player.isCrouching;
        took = this.player.crouch() && !wasCrouching;
        break;
      }
    }
    if (took) this.emit("playerAction", movement);
  }

  update(dtMs: number): void {
    if (!isActive(this._state) || dtMs <= 0) return;

    this.player.update(dtMs);
    this.advanceQuestionFlow(dtMs);

    const worldDt = dtMs * this._timeScale;
    this._elapsedMs += worldDt;
    const progressStep = (worldDt / this.config.speed.travelTimeMs) * this.speedMultiplier;

    if (!this.updateObstacles(progressStep)) return;
    this.updateGates(progressStep);

    // Obstacles pause while a question is on its way so the player can focus on it.
    if (!this._gate) {
      this.spawnTimerMs -= worldDt;
      if (this.spawnTimerMs <= 0) {
        this.spawn();
      }
    }

    const wholeSeconds = Math.floor(this._elapsedMs / 1000);
    if (wholeSeconds > this.secondsScored) {
      this._score += (wholeSeconds - this.secondsScored) * this.config.score.perSecondSurvived;
      this.secondsScored = wholeSeconds;
    }
  }

  // --- question sequence ----------------------------------------------------

  /** True while the player's answer should be collected. */
  private get acceptingAnswers(): boolean {
    return this._state === "SLOW_MOTION" || this._state === "QUESTION" || this._state === "WAITING_FOR_MOVEMENT";
  }

  private advanceQuestionFlow(dtMs: number): void {
    const sm = this.config.slowMotion;
    this.phaseMs += dtMs;
    if (this._state !== "RUNNING" && this._state !== "RESUMING") this.flowClockMs += dtMs;

    switch (this._state) {
      case "RUNNING": {
        const gate = this._gate;
        if (gate && !this.warned && gate.progress >= sm.warningProgress) {
          this.warned = true;
          this.emit("questionWarning", gate.session);
        }
        if (gate && gate.progress >= sm.slowStartProgress) this.beginSlowMotion();
        break;
      }
      case "SLOW_MOTION": {
        this._timeScale = 1 + (sm.slowFactor - 1) * ease(this.phaseMs / sm.rampDownMs);
        if (this.phaseMs >= sm.rampDownMs && this._gate) {
          this._timeScale = sm.slowFactor;
          this.setState("QUESTION");
          this.emit("questionStarted", this._gate.session);
        }
        break;
      }
      case "QUESTION":
        this._timeScale = sm.slowFactor;
        if (this.phaseMs >= sm.readMs) {
          this.waitingStartedAt = this.flowClockMs;
          this.setState("WAITING_FOR_MOVEMENT");
        }
        break;
      case "WAITING_FOR_MOVEMENT":
        this._timeScale = sm.slowFactor;
        if (this.responseLockedIn() || this.phaseMs >= sm.responseWindowMs) this.validateAnswer();
        break;
      case "RESUMING":
        this._timeScale = sm.slowFactor + (1 - sm.slowFactor) * ease(this.phaseMs / sm.resumeRampMs);
        if (this.phaseMs >= sm.resumeRampMs) {
          this._timeScale = 1;
          this.setState("RUNNING");
        }
        break;
      default:
        break;
    }
  }

  private beginSlowMotion(): void {
    this.flowClockMs = 0;
    this.lastResponseAt = null;
    this.laneChangedAt = 0;
    this.setState("SLOW_MOTION");
  }

  /** The player has settled on an answer, so there is no need to wait out the whole window. */
  private responseLockedIn(): boolean {
    const gate = this._gate;
    if (!gate) return true;
    const sm = this.config.slowMotion;
    if (gate.session.question.type === "MOVEMENT") {
      return this.lastResponseAt !== null && this.flowClockMs - this.lastResponseAt >= sm.movementLockInMs;
    }
    const settledSince = Math.max(this.laneChangedAt, this.waitingStartedAt);
    return this.flowClockMs - settledSince >= sm.laneLockInMs;
  }

  /** Judge the response, award points, and start easing back to normal speed. */
  private validateAnswer(): void {
    const gate = this._gate;
    if (!gate) {
      this.setState("RESUMING");
      return;
    }
    const { question } = gate.session;
    const result = gate.session.resolve(this.player.lane);
    const score = scoreAnswer(question, result, this.stats.streak, this.decisionTimeLeft(), this.config.questions.scoring);

    this._gate = null;
    this._exitingGate = { ...gate, result };
    this.spawnTimerMs = this.config.questions.gapAfterQuestionMs;
    this._score = Math.max(0, this._score + score.total);
    this.stats.record(question, score);
    this.questions?.recordResult(result.correct);

    this.setState("RESUMING");
    this.emit("questionAnswered", { question, result, score });
  }

  /**
   * How much of the answer window was still left when the player made their final
   * choice (1 = decided at once, 0 = at the last moment or never).
   */
  private decisionTimeLeft(): number {
    const gate = this._gate;
    if (!gate) return 0;
    const decidedAt = gate.session.question.type === "MOVEMENT" ? this.lastResponseAt : this.laneChangedAt;
    if (decidedAt === null) return 0;
    const taken = Math.max(0, decidedAt - this.waitingStartedAt);
    return Math.max(0, 1 - taken / this.config.slowMotion.responseWindowMs);
  }

  // --- world simulation -----------------------------------------------------

  /** Advance obstacles. Returns false if the game ended (collision). */
  private updateObstacles(progressStep: number): boolean {
    const zone = this.config.collision.hitHalfDepth;

    for (const obstacle of this.obstacles) {
      obstacle.progress += progressStep;
      if (collides(obstacle, this.player, this.config.collision)) {
        this.emit("collision", obstacle);
        this.transition("GAME_OVER");
        return false;
      }
      if (!obstacle.passed && obstacle.progress > 1 + zone) {
        obstacle.passed = true;
        this._score += this.config.score.perObstacleDodged;
        this.emit("obstacleDodged", obstacle);
      }
    }

    // Drop obstacles once they are well past the player.
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      if (this.obstacles[i].progress > OBSTACLE_REMOVE_PROGRESS) this.obstacles.splice(i, 1);
    }
    return true;
  }

  private updateGates(progressStep: number): void {
    const gate = this._gate;
    if (gate) {
      gate.progress += progressStep;
      // While the question is open the gate waits just before the player line.
      if (this._state !== "RUNNING") gate.progress = Math.min(gate.progress, this.config.slowMotion.holdProgress);
    }

    const exiting = this._exitingGate;
    if (exiting) {
      exiting.progress += progressStep;
      if (exiting.progress > GATE_EXIT_PROGRESS) this._exitingGate = null;
    }
  }

  private spawnGate(): void {
    if (!this.questions) return;
    const session = this.questions.next();
    this._gate = { progress: 0, session };
    this._exitingGate = null;
    this.spawnsSinceGate = 0;
    this.warned = false;
  }

  /** True when every obstacle has gone by, so a question will not compete with a hazard. */
  private roadClear(): boolean {
    return this.obstacles.every((o) => o.passed);
  }

  private spawn(): void {
    const q = this.config.questions;
    const gateDue = this.questions !== null && q.enabled && this.spawnsSinceGate >= q.everyNObstacles;
    if (gateDue) {
      if (!this.roadClear()) {
        this.spawnTimerMs = GATE_RETRY_MS;
        return;
      }
      this.spawnGate();
      this.spawnTimerMs = this.nextSpawnDelay();
      return;
    }

    this.spawnsSinceGate++;
    const lane = LANES[Math.floor(this.random() * LANES.length)];
    this.obstacles.push({ id: this.nextId++, kind: this.pickKind(), lane, progress: 0, passed: false });
    this.spawnTimerMs += this.nextSpawnDelay();
  }

  private pickKind(): ObstacleKind {
    const { weights } = this.config.spawn;
    const kinds = Object.keys(weights) as ObstacleKind[];
    const total = kinds.reduce((sum, k) => sum + weights[k], 0);
    let roll = this.random() * total;
    for (const kind of kinds) {
      roll -= weights[kind];
      if (roll < 0) return kind;
    }
    return kinds[kinds.length - 1];
  }

  /** Spawn gap shrinks as the game speeds up so obstacle spacing stays constant. */
  private nextSpawnDelay(): number {
    const { minIntervalMs, maxIntervalMs } = this.config.spawn;
    const base = minIntervalMs + this.random() * (maxIntervalMs - minIntervalMs);
    return base / this.speedMultiplier;
  }

  private resetRun(): void {
    this.obstacles.length = 0;
    this._gate = null;
    this._exitingGate = null;
    this.spawnsSinceGate = 0;
    this.questions?.reset();
    this.stats.reset();
    this.player.reset();
    this._score = 0;
    this._elapsedMs = 0;
    this.secondsScored = 0;
    this.nextId = 1;
    this._timeScale = 1;
    this.phaseMs = 0;
    this.flowClockMs = 0;
    this.warned = false;
    this.lastResponseAt = null;
    this.laneChangedAt = 0;
    this.waitingStartedAt = 0;
    this.spawnTimerMs = this.nextSpawnDelay();
  }

  /** State change driven by the question flow (resets the phase clock). */
  private setState(to: GameState): void {
    this.phaseMs = 0;
    this.transition(to);
  }

  private transition(to: GameState): void {
    const from = this._state;
    if (from === to || !canTransition(from, to)) return;
    this._state = to;
    this.emit("stateChange", { from, to });
  }
}
