import { gameConfig, type CameraSize, type MovementSensitivity, type PresetsConfig, type RunnerConfig, type SpeedPreset } from "../config/gameConfig";
import { DIFFICULTIES, type Difficulty } from "../questions";

/** Difficulty choices in the menu: a fixed level, or rising with the player's correct answers. */
export type DifficultyChoice = "progressive" | Difficulty;

export interface PlayerSettings {
  /** Categories to ask (null = all of them). */
  categories: string[] | null;
  difficulty: DifficultyChoice;
  speed: SpeedPreset;

  /** Seconds the question is shown (world slowed) before answers are collected. */
  readSeconds: number;
  /** Longest time, in seconds, the player has to answer. */
  answerSeconds: number;
  /** Lock the answer in as soon as the player has settled, instead of always waiting the full time. */
  autoLock: boolean;
  /** Seconds standing in one lane (or after the last movement) before the answer locks in. */
  lockInSeconds: number;

  sensitivity: MovementSensitivity;
  cameraSize: CameraSize;

  sound: boolean;
  /** 0..1 */
  volume: number;
  highContrast: boolean;
  reducedMotion: boolean;
  showCameraPreview: boolean;
}

/** Slider ranges for the timers, shared by the menu and by sanitizeSettings. */
export const TIMER_LIMITS = {
  readSeconds: { min: 0.5, max: 8, step: 0.1 },
  answerSeconds: { min: 2, max: 20, step: 0.5 },
  lockInSeconds: { min: 0.5, max: 6, step: 0.1 },
} as const;

const sm = gameConfig.runner.slowMotion;

export const DEFAULT_SETTINGS: Readonly<PlayerSettings> = {
  categories: null,
  difficulty: "progressive",
  speed: "normal",
  readSeconds: sm.readMs / 1000,
  answerSeconds: sm.responseWindowMs / 1000,
  autoLock: true,
  lockInSeconds: sm.laneLockInMs / 1000,
  sensitivity: "normal",
  cameraSize: "large",
  sound: true,
  volume: 0.6,
  highContrast: false,
  reducedMotion: false,
  showCameraPreview: true,
};

const SPEEDS: readonly SpeedPreset[] = ["relaxed", "normal", "fast"];
const SENSITIVITIES: readonly MovementSensitivity[] = ["low", "normal", "high"];
const CAMERA_SIZES: readonly CameraSize[] = ["small", "medium", "large"];
/** Earlier versions had one "answer time" choice; these are the multipliers it stood for. */
const LEGACY_ANSWER_TIME_SCALE: Readonly<Record<string, number>> = { normal: 1, long: 1.5, veryLong: 2 };

export const SETTINGS_STORAGE_KEY = "motion-runner.settings.v1";

/** The slice of the Storage API the app uses, so tests (and private windows) can substitute. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * Settings saved before the timers were adjustable carry one "answerTime" choice. Returns the
 * data with the equivalent read and answer times filled in (new fields, when present, win).
 */
function withLegacyTimers(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const r = raw as Record<string, unknown>;
  const scale = typeof r.answerTime === "string" ? LEGACY_ANSWER_TIME_SCALE[r.answerTime] : undefined;
  if (scale === undefined) return raw;
  return {
    ...r,
    readSeconds: r.readSeconds ?? DEFAULT_SETTINGS.readSeconds * scale,
    answerSeconds: r.answerSeconds ?? DEFAULT_SETTINGS.answerSeconds * scale,
  };
}

function timer(value: unknown, limits: { min: number; max: number }, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, limits.min, limits.max) : fallback;
}

/**
 * Turns untrusted data (stored JSON, an old version, hand-edited values) into valid
 * settings. Anything missing or invalid falls back to the default for that field.
 * `knownCategories`, when given, drops category ids that no longer exist.
 */
export function sanitizeSettings(input: unknown, knownCategories?: readonly string[]): PlayerSettings {
  const d = DEFAULT_SETTINGS;
  const raw = withLegacyTimers(input);
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

  let categories: string[] | null = d.categories;
  if (Array.isArray(r.categories)) {
    const ids = r.categories.filter((c): c is string => typeof c === "string" && c !== "");
    const valid = knownCategories ? ids.filter((c) => knownCategories.includes(c)) : ids;
    // An empty or fully invalid list would leave nothing to ask, so treat it as "all".
    categories = valid.length > 0 && !(knownCategories && valid.length === knownCategories.length) ? valid : null;
  }

  const volume = typeof r.volume === "number" && Number.isFinite(r.volume) ? clamp(r.volume, 0, 1) : d.volume;

  return {
    categories,
    difficulty: r.difficulty === "progressive" || DIFFICULTIES.includes(r.difficulty as Difficulty) ? (r.difficulty as DifficultyChoice) : d.difficulty,
    speed: SPEEDS.includes(r.speed as SpeedPreset) ? (r.speed as SpeedPreset) : d.speed,
    readSeconds: timer(r.readSeconds, TIMER_LIMITS.readSeconds, d.readSeconds),
    answerSeconds: timer(r.answerSeconds, TIMER_LIMITS.answerSeconds, d.answerSeconds),
    autoLock: bool(r.autoLock, d.autoLock),
    lockInSeconds: timer(r.lockInSeconds, TIMER_LIMITS.lockInSeconds, d.lockInSeconds),
    sensitivity: SENSITIVITIES.includes(r.sensitivity as MovementSensitivity) ? (r.sensitivity as MovementSensitivity) : d.sensitivity,
    cameraSize: CAMERA_SIZES.includes(r.cameraSize as CameraSize) ? (r.cameraSize as CameraSize) : d.cameraSize,
    sound: bool(r.sound, d.sound),
    volume,
    highContrast: bool(r.highContrast, d.highContrast),
    reducedMotion: bool(r.reducedMotion, d.reducedMotion),
    showCameraPreview: bool(r.showCameraPreview, d.showCameraPreview),
  };
}

/** Load saved settings. Never throws: storage can be blocked, empty or corrupt. */
export function loadSettings(
  store: KeyValueStore | null,
  knownCategories?: readonly string[],
  /** Used when nothing has been saved yet (e.g. the OS "reduce motion" setting). */
  defaults: Partial<PlayerSettings> = {},
): PlayerSettings {
  const fallback = { ...DEFAULT_SETTINGS, ...defaults };
  try {
    const text = store?.getItem(SETTINGS_STORAGE_KEY);
    if (!text) return sanitizeSettings(fallback, knownCategories);
    // Migrate first: merging the defaults in first would hide the old fields the migration needs.
    return sanitizeSettings({ ...fallback, ...(withLegacyTimers(JSON.parse(text)) as object) }, knownCategories);
  } catch {
    return sanitizeSettings(fallback, knownCategories);
  }
}

/** Save settings. Returns false if the browser refused (private mode, quota…). */
export function saveSettings(store: KeyValueStore | null, settings: PlayerSettings): boolean {
  try {
    store?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return store !== null;
  } catch {
    return false;
  }
}

/** The runner config the player's settings produce (speed, question timers, categories, difficulty). */
export function applySettings(base: RunnerConfig, settings: PlayerSettings, presets: PresetsConfig): RunnerConfig {
  const progressive = settings.difficulty === "progressive";
  const lockIn = settings.lockInSeconds * 1000;
  return {
    ...base,
    speed: presets.speed[settings.speed],
    slowMotion: {
      ...base.slowMotion,
      readMs: Math.round(settings.readSeconds * 1000),
      responseWindowMs: Math.round(settings.answerSeconds * 1000),
      // With auto-lock off the answer is only judged when the time runs out.
      laneLockInMs: settings.autoLock ? Math.round(lockIn) : Number.POSITIVE_INFINITY,
      movementLockInMs: settings.autoLock ? Math.round(Math.min(base.slowMotion.movementLockInMs, lockIn)) : Number.POSITIVE_INFINITY,
    },
    questions: {
      ...base.questions,
      categories: settings.categories,
      difficulty: {
        ...base.questions.difficulty,
        mode: progressive ? "progressive" : "fixed",
        fixed: progressive ? base.questions.difficulty.fixed : (settings.difficulty as Difficulty),
      },
    },
  };
}
