/**
 * Centralized tunable values. Do not hard-code these elsewhere.
 * Values are starting points and should be calibrated during development.
 */

export type PoseModelVariant = "lite" | "full" | "heavy";

export interface CameraConfig {
  idealWidth: number;
  idealHeight: number;
  idealFrameRate: number;
  facingMode: "user" | "environment";
  /** Mirror the view and landmark x-coordinates so the player sees a "selfie" view. */
  mirror: boolean;
}

export interface PoseConfig {
  model: PoseModelVariant;
  /** Base URL for the MediaPipe WASM files. */
  wasmBaseUrl: string;
  /** URL template; `{model}` is replaced with the variant. */
  modelUrlTemplate: string;
  delegate: "GPU" | "CPU";
  /** Pose inference rate, decoupled from rendering. */
  targetInferenceFps: number;
  minPoseDetectionConfidence: number;
  minPosePresenceConfidence: number;
  minTrackingConfidence: number;
  /** Landmarks below this visibility are treated as missing. */
  minLandmarkVisibility: number;
}

export interface DebugConfig {
  enabled: boolean;
  showVideo: boolean;
  landmarkRadiusPx: number;
  connectionWidthPx: number;
  bodyCenterRadiusPx: number;
  /** How often FPS readouts are recalculated. */
  fpsSampleWindowMs: number;
}

import type { Lane } from "../movement/MovementTypes";
import type { Difficulty } from "../questions/Question";

/*
 * Vertical movement values are expressed in TORSO UNITS: a fraction of the
 * player's baseline torso length (shoulder-mid → hip-mid). This keeps the
 * thresholds independent of camera resolution and of how far the player
 * stands from the camera.
 */

export interface LaneConfig {
  /** Normalized x boundaries between LEFT|CENTER and CENTER|RIGHT. */
  thresholds: { left: number; right: number };
  /** Extra normalized distance past a boundary required to switch lanes. */
  hysteresis: number;
  /** A new lane must be held this long before it is reported. */
  minStableMs: number;
  /** EMA factor for body-center x (0 = frozen, 1 = no smoothing). */
  smoothing: number;
}

export interface BaselineConfig {
  /** Valid standing samples required before jump/crouch detection starts. */
  warmupSamples: number;
  /** EMA factor for the standing hip height and torso length. */
  smoothing: number;
  /**
   * The baseline keeps adapting while the detectors are idle and the hip is within this band
   * (torso units). It must be wide: a narrow band stops the baseline learning when the player
   * steps closer, steps back or stands taller, and jumps then stop being detected.
   */
  updateBand: number;
  /** Forget the baseline after tracking has been lost this long. */
  resetAfterLostMs: number;
}

export interface JumpConfig {
  /** Hip rise above baseline that counts as airborne (torso units). */
  minimumDisplacement: number;
  /** Rise from grounded to airborne must happen within this window. */
  detectionWindowMs: number;
  /**
   * The jump is reported once the rise has lasted this long (filters one- and two-frame
   * noise). It is reported at take-off, not on landing, so the game can react in time.
   */
  confirmMs: number;
  /** Airborne longer than this ends the jump (the player is standing on something, or tracking drifted). */
  maxAirTimeMs: number;
  /** Landed when displacement falls below minimumDisplacement × this ratio. */
  landingRatio: number;
  cooldownMs: number;
  minConfidence: number;
}

export interface CrouchConfig {
  /** Hip drop below baseline to start lowering (torso units). */
  enterDrop: number;
  /** Hip drop below which the player is considered standing again (hysteresis). */
  exitDrop: number;
  /** A knee angle at or below this lets a smaller hip drop count as lowering. */
  kneeAngleDeg: number;
  /** With a bent knee, the hip drop only needs to reach enterDrop × this ratio. */
  kneeAssistRatio: number;
  /** Lowered state must be held this long before CROUCH is confirmed. */
  minimumDurationMs: number;
  /** Standing signal must be held this long before leaving CROUCHING. */
  exitDurationMs: number;
  minConfidence: number;
}

export interface MovementConfig {
  /** Frames whose torso confidence is below this are ignored. */
  minPoseConfidence: number;
  /** Reset jump/crouch state after tracking has been lost this long. */
  trackingLostResetMs: number;
  lane: LaneConfig;
  baseline: BaselineConfig;
  jump: JumpConfig;
  crouch: CrouchConfig;
}

export interface RunnerViewConfig {
  width: number;
  height: number;
  /** Where obstacles appear, as a fraction of view height from the top. */
  horizonY: number;
  /** Where the player stands, as a fraction of view height from the top. */
  playerY: number;
  /** Road width at the horizon / at the player line, as a fraction of view width. */
  roadWidthTop: number;
  roadWidthBottom: number;
  /** Obstacle scale at the horizon (grows to 1 at the player line). */
  obstacleMinScale: number;
  laneChangeTweenMs: number;
}

export interface RunnerSpeedConfig {
  /** Time an obstacle takes to travel from spawn to the player at speed ×1. */
  travelTimeMs: number;
  /** Speed multiplier gained per second of play. */
  accelerationPerSecond: number;
  maxMultiplier: number;
}

export interface RunnerSpawnConfig {
  minIntervalMs: number;
  maxIntervalMs: number;
  /** Relative chance of each obstacle kind. */
  weights: { BARRIER: number; LOW: number; HIGH: number };
}

export interface RunnerPlayerConfig {
  jumpDurationMs: number;
  /** Jump arc height (0..1) above which the player clears LOW obstacles. */
  airborneThreshold: number;
  /** How long a crouch lasts once triggered (movement events are one-shot). */
  crouchHoldMs: number;
}

export interface RunnerCollisionConfig {
  /** Half depth of the hit zone around the player line, in travel progress (0..1). */
  hitHalfDepth: number;
}

export interface RunnerScoreConfig {
  perObstacleDodged: number;
  perSecondSurvived: number;
}

export interface DifficultyConfig {
  /** "fixed" always asks `fixed`; "progressive" rises with the number of correct answers in a run. */
  mode: "fixed" | "progressive";
  fixed: Difficulty;
  /** Progressive: correct answers needed before MEDIUM / HARD questions start. */
  thresholds: { MEDIUM: number; HARD: number };
}

export interface ScoringConfig {
  /** Points for a correct answer, by question difficulty. */
  basePoints: Record<Difficulty, number>;
  /** Each consecutive correct answer adds this to the multiplier (0.1 → ×1.1, ×1.2, …). */
  streakStep: number;
  maxStreakMultiplier: number;
  /** Extra points for answering early in the answer window (full bonus if decided at once). */
  maxSpeedBonus: number;
  /** Added for a wrong or missing answer (use a negative number for a penalty; score never drops below 0). */
  incorrectPoints: number;
}

export interface QuestionsConfig {
  /** Turn the question gates on or off. */
  enabled: boolean;
  /** Lane for answer A, B, C… of a LANE question (configurable, never hard-coded in game logic). */
  laneOrder: readonly Lane[];
  /** A question gate replaces every Nth obstacle spawn. */
  everyNObstacles: number;
  /** Quiet time after a question before obstacles resume. */
  gapAfterQuestionMs: number;
  scoring: ScoringConfig;
  /** Only ask these categories (null = every category in the question bank). */
  categories: readonly string[] | null;
  /** Display names for category ids; an id without an entry is shown as-is. */
  categoryLabels: Readonly<Record<string, string>>;
  difficulty: DifficultyConfig;
  /** How long the correct/incorrect feedback stays on screen. */
  feedbackMs: number;
  /** Shuffle the order questions are asked in (each is asked once per cycle). */
  shuffle: boolean;
  /** Shuffle which lane each answer of a LANE question lands in (unless the question opts out). */
  shuffleAnswers: boolean;
  /** Player-facing strings, so the content language is configurable. */
  text: {
    warning: string;
    correct: string;
    incorrect: string;
    noAnswer: string;
    correctAnswerPrefix: string;
    streak: string;
    speedBonus: string;
    difficulty: Record<Difficulty, string>;
    summary: { questions: string; correct: string; bestStreak: string; byCategory: string };
  };
}

/**
 * Timing of the question sequence:
 * RUNNING → (warning) → SLOW_MOTION → QUESTION → WAITING_FOR_MOVEMENT → RESUMING → RUNNING.
 * Progress values are gate travel progress (0 = horizon, 1 = player line).
 * Durations are real time; only the world (obstacles, gate) is slowed.
 */
export interface SlowMotionConfig {
  /** Gate progress at which the "question ahead" warning appears. */
  warningProgress: number;
  /** Gate progress at which slow motion begins. */
  slowStartProgress: number;
  /** The gate never advances past this while a question is open. */
  holdProgress: number;
  /** World speed during the question, relative to normal (0 < factor < 1). */
  slowFactor: number;
  /** Time to ease from normal speed down to slowFactor. */
  rampDownMs: number;
  /** Time the question is shown before answers are collected. */
  readMs: number;
  /** Longest time the player has to answer after the reading time. */
  responseWindowMs: number;
  /** LANE: answer locks in once the player has stood in one lane this long. */
  laneLockInMs: number;
  /** MOVEMENT: answer locks in this long after the last answer movement. */
  movementLockInMs: number;
  /** Time to ease from slowFactor back to normal speed. */
  resumeRampMs: number;
}

export interface RunnerConfig {
  view: RunnerViewConfig;
  speed: RunnerSpeedConfig;
  spawn: RunnerSpawnConfig;
  player: RunnerPlayerConfig;
  collision: RunnerCollisionConfig;
  score: RunnerScoreConfig;
  questions: QuestionsConfig;
  slowMotion: SlowMotionConfig;
}

export interface CalibrationConfig {
  /** STAND: how long the player must stay still. */
  standDurationMs: number;
  minStandSamples: number;
  /** STAND restarts if the body moves more than this (x in image width, y in torso lengths). */
  standToleranceX: number;
  standToleranceY: number;
  /** LEFT / RIGHT: shift from the standing position that counts as "moved", and how long to hold it. */
  laneShiftMin: number;
  holdMs: number;
  /** A movement this fraction of the way to the target (but not there yet) earns a "a bit further" hint. */
  hintFraction: number;
  /** JUMP: hip rise (torso lengths) that counts as a jump, and the level that counts as landed. */
  jumpMinPeak: number;
  jumpLandedBelow: number;
  /** CROUCH: hip drop (torso lengths) that counts as crouching. */
  crouchMinDrop: number;
  /** Tracking lost this long restarts the current step's progress. */
  lostResetMs: number;

  /** Where between standing and the measured extreme a lane boundary sits (0.5 = halfway). */
  laneThresholdFraction: number;
  /** The CENTER lane is never narrower than this (image width). */
  minLaneGap: number;
  /** Jump threshold as a fraction of the player's measured jump height, and its limits. */
  jumpThresholdFraction: number;
  jumpThresholdMin: number;
  jumpThresholdMax: number;
  /** Crouch threshold as a fraction of the measured drop, its limits, and the exit level relative to it. */
  crouchEnterFraction: number;
  crouchEnterMin: number;
  crouchEnterMax: number;
  crouchExitFraction: number;
}

export interface PresenceConfig {
  /** Tracking lost this long pauses a camera-controlled game. */
  lostAfterMs: number;
  /** The player must be seen this long before the game resumes. */
  foundAfterMs: number;
}

export interface InputConfig {
  /** Movement events below this confidence are ignored by the game. */
  minMovementConfidence: number;
  /** A JUMP movement starts the game from READY (and restarts after GAME_OVER). */
  startWithJump: boolean;
  /** After GAME_OVER, ignore start gestures for this long so a stray jump does not restart. */
  restartCooldownMs: number;
  /** Show the small webcam preview next to the game. */
  showCameraPreview: boolean;
  presence: PresenceConfig;
  calibration: CalibrationConfig;
}

export type SpeedPreset = "relaxed" | "normal" | "fast";
/** How readily movements are detected: "high" reacts to smaller, quicker movements. */
export type MovementSensitivity = "low" | "normal" | "high";
export type CameraSize = "small" | "medium" | "large";

/** Choices offered in the settings menu. */
export interface PresetsConfig {
  speed: Record<SpeedPreset, RunnerSpeedConfig>;
  /**
   * Scales the movement thresholds: `threshold` multiplies how far a movement must go,
   * `time` multiplies how long it must last.
   */
  sensitivity: Record<MovementSensitivity, { threshold: number; time: number }>;
}

export interface GameConfig {
  camera: CameraConfig;
  pose: PoseConfig;
  movement: MovementConfig;
  runner: RunnerConfig;
  input: InputConfig;
  presets: PresetsConfig;
  debug: DebugConfig;
}

const MEDIAPIPE_TASKS_VISION_VERSION = "1.0.1";

export const gameConfig: GameConfig = {
  camera: {
    idealWidth: 1280,
    idealHeight: 720,
    idealFrameRate: 30,
    facingMode: "user",
    mirror: true,
  },
  pose: {
    model: "lite",
    wasmBaseUrl: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VISION_VERSION}/wasm`,
    modelUrlTemplate:
      "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_{model}/float16/1/pose_landmarker_{model}.task",
    delegate: "GPU",
    targetInferenceFps: 30,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    minLandmarkVisibility: 0.5,
  },
  movement: {
    minPoseConfidence: 0.5,
    trackingLostResetMs: 800,
    lane: {
      thresholds: { left: 0.33, right: 0.66 },
      hysteresis: 0.03,
      minStableMs: 120,
      smoothing: 0.5,
    },
    baseline: {
      warmupSamples: 15,
      smoothing: 0.03,
      updateBand: 0.5,
      resetAfterLostMs: 3000,
    },
    jump: {
      minimumDisplacement: 0.18,
      detectionWindowMs: 280,
      confirmMs: 60,
      maxAirTimeMs: 1200,
      landingRatio: 0.5,
      cooldownMs: 600,
      minConfidence: 0.5,
    },
    crouch: {
      enterDrop: 0.25,
      exitDrop: 0.15,
      kneeAngleDeg: 130,
      kneeAssistRatio: 0.6,
      minimumDurationMs: 150,
      exitDurationMs: 150,
      minConfidence: 0.5,
    },
  },
  runner: {
    view: {
      width: 480,
      height: 800,
      horizonY: 0.18,
      playerY: 0.82,
      roadWidthTop: 0.3,
      roadWidthBottom: 0.95,
      obstacleMinScale: 0.25,
      laneChangeTweenMs: 120,
    },
    speed: {
      travelTimeMs: 2200,
      accelerationPerSecond: 0.01,
      maxMultiplier: 2,
    },
    spawn: {
      minIntervalMs: 900,
      maxIntervalMs: 1700,
      weights: { BARRIER: 3, LOW: 2, HIGH: 2 },
    },
    player: {
      jumpDurationMs: 700,
      airborneThreshold: 0.5,
      crouchHoldMs: 700,
    },
    collision: {
      hitHalfDepth: 0.04,
    },
    score: {
      perObstacleDodged: 10,
      perSecondSurvived: 1,
    },
    questions: {
      enabled: true,
      laneOrder: ["LEFT", "CENTER", "RIGHT"],
      everyNObstacles: 3,
      gapAfterQuestionMs: 1500,
      scoring: {
        basePoints: { EASY: 50, MEDIUM: 75, HARD: 100 },
        streakStep: 0.1,
        maxStreakMultiplier: 2,
        maxSpeedBonus: 25,
        incorrectPoints: -10,
      },
      categories: null,
      categoryLabels: {
        math: "Matematika",
        science: "IPA",
        geography: "Geografi",
        language: "Bahasa Indonesia",
        logic: "Benar / Salah",
        safety: "Keselamatan",
      },
      difficulty: {
        mode: "progressive",
        fixed: "EASY",
        thresholds: { MEDIUM: 3, HARD: 8 },
      },
      feedbackMs: 2200,
      shuffle: true,
      shuffleAnswers: true,
      text: {
        warning: "Siap-siap, ada soal!",
        correct: "Benar!",
        incorrect: "Salah",
        noAnswer: "Tidak menjawab",
        correctAnswerPrefix: "Jawaban:",
        streak: "Streak",
        speedBonus: "Cepat",
        difficulty: { EASY: "Mudah", MEDIUM: "Sedang", HARD: "Sulit" },
        summary: { questions: "Soal", correct: "Benar", bestStreak: "Streak terbaik", byCategory: "Per kategori" },
      },
    },
    slowMotion: {
      warningProgress: 0.05,
      slowStartProgress: 0.42,
      holdProgress: 0.8,
      slowFactor: 0.2,
      rampDownMs: 400,
      readMs: 1800,
      responseWindowMs: 5000,
      laneLockInMs: 1800,
      movementLockInMs: 600,
      resumeRampMs: 600,
    },
  },
  input: {
    minMovementConfidence: 0.6,
    startWithJump: true,
    restartCooldownMs: 1200,
    showCameraPreview: true,
    presence: { lostAfterMs: 1500, foundAfterMs: 800 },
    calibration: {
      standDurationMs: 1500,
      minStandSamples: 15,
      standToleranceX: 0.05,
      standToleranceY: 0.12,
      laneShiftMin: 0.08,
      holdMs: 400,
      hintFraction: 0.4,
      jumpMinPeak: 0.1,
      jumpLandedBelow: 0.04,
      crouchMinDrop: 0.12,
      lostResetMs: 600,
      laneThresholdFraction: 0.5,
      minLaneGap: 0.15,
      jumpThresholdFraction: 0.4,
      jumpThresholdMin: 0.07,
      jumpThresholdMax: 0.35,
      crouchEnterFraction: 0.5,
      crouchEnterMin: 0.09,
      crouchEnterMax: 0.45,
      crouchExitFraction: 0.6,
    },
  },
  presets: {
    speed: {
      relaxed: { travelTimeMs: 2800, accelerationPerSecond: 0.005, maxMultiplier: 1.5 },
      normal: { travelTimeMs: 2200, accelerationPerSecond: 0.01, maxMultiplier: 2 },
      fast: { travelTimeMs: 1800, accelerationPerSecond: 0.015, maxMultiplier: 2.5 },
    },
    sensitivity: {
      low: { threshold: 1.3, time: 1.3 },
      normal: { threshold: 1, time: 1 },
      high: { threshold: 0.7, time: 0.6 },
    },
  },
  debug: {
    enabled: true,
    showVideo: true,
    landmarkRadiusPx: 5,
    connectionWidthPx: 3,
    bodyCenterRadiusPx: 9,
    fpsSampleWindowMs: 500,
  },
};
