import { describe, expect, it } from "vitest";
import { gameConfig } from "../config/gameConfig";
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, TIMER_LIMITS, applySettings, loadSettings, sanitizeSettings, saveSettings, type KeyValueStore } from "./Settings";

const presets = gameConfig.presets;
const runner = gameConfig.runner;
const CATEGORIES = ["math", "science", "logic"];

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe("DEFAULT_SETTINGS", () => {
  it("start from the game's own timing", () => {
    expect(DEFAULT_SETTINGS.readSeconds * 1000).toBe(runner.slowMotion.readMs);
    expect(DEFAULT_SETTINGS.answerSeconds * 1000).toBe(runner.slowMotion.responseWindowMs);
    expect(DEFAULT_SETTINGS.lockInSeconds * 1000).toBe(runner.slowMotion.laneLockInMs);
  });

  it("sit inside the slider ranges", () => {
    for (const key of ["readSeconds", "answerSeconds", "lockInSeconds"] as const) {
      expect(DEFAULT_SETTINGS[key]).toBeGreaterThanOrEqual(TIMER_LIMITS[key].min);
      expect(DEFAULT_SETTINGS[key]).toBeLessThanOrEqual(TIMER_LIMITS[key].max);
    }
  });
});

describe("sanitizeSettings", () => {
  it("returns the defaults for garbage", () => {
    for (const bad of [null, undefined, 42, "x", [], {}]) expect(sanitizeSettings(bad)).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values", () => {
    const valid = {
      categories: ["math"],
      difficulty: "HARD",
      speed: "fast",
      readSeconds: 3,
      answerSeconds: 9,
      autoLock: false,
      lockInSeconds: 2.5,
      sensitivity: "high",
      cameraSize: "small",
      sound: false,
      volume: 0.2,
      highContrast: true,
      reducedMotion: true,
      showCameraPreview: false,
    };
    expect(sanitizeSettings(valid)).toEqual(valid);
  });

  it("replaces invalid fields one by one", () => {
    const s = sanitizeSettings({ difficulty: "IMPOSSIBLE", speed: "warp", sensitivity: "extreme", cameraSize: "huge", sound: "yes", volume: "loud", highContrast: true });
    expect(s).toMatchObject({ difficulty: "progressive", speed: "normal", sensitivity: "normal", cameraSize: "large", sound: true, volume: DEFAULT_SETTINGS.volume, highContrast: true });
  });

  it("clamps volume and the timers into range", () => {
    expect(sanitizeSettings({ volume: 7 }).volume).toBe(1);
    expect(sanitizeSettings({ volume: -1 }).volume).toBe(0);
    expect(sanitizeSettings({ volume: NaN }).volume).toBe(DEFAULT_SETTINGS.volume);
    expect(sanitizeSettings({ readSeconds: 0 }).readSeconds).toBe(TIMER_LIMITS.readSeconds.min);
    expect(sanitizeSettings({ readSeconds: 999 }).readSeconds).toBe(TIMER_LIMITS.readSeconds.max);
    expect(sanitizeSettings({ answerSeconds: 1 }).answerSeconds).toBe(TIMER_LIMITS.answerSeconds.min);
    expect(sanitizeSettings({ lockInSeconds: 100 }).lockInSeconds).toBe(TIMER_LIMITS.lockInSeconds.max);
  });

  it("ignores non-numeric timers", () => {
    expect(sanitizeSettings({ readSeconds: "5", answerSeconds: NaN, lockInSeconds: Infinity })).toMatchObject({
      readSeconds: DEFAULT_SETTINGS.readSeconds,
      answerSeconds: DEFAULT_SETTINGS.answerSeconds,
      lockInSeconds: DEFAULT_SETTINGS.lockInSeconds,
    });
  });

  it("drops unknown categories and treats an empty result as all", () => {
    expect(sanitizeSettings({ categories: ["math", "art"] }, CATEGORIES).categories).toEqual(["math"]);
    expect(sanitizeSettings({ categories: ["art"] }, CATEGORIES).categories).toBeNull();
    expect(sanitizeSettings({ categories: [] }, CATEGORIES).categories).toBeNull();
    expect(sanitizeSettings({ categories: [1, null, ""] }, CATEGORIES).categories).toBeNull();
  });

  it("treats every category selected as 'all'", () => {
    expect(sanitizeSettings({ categories: [...CATEGORIES] }, CATEGORIES).categories).toBeNull();
  });
});

describe("settings saved by the earlier version", () => {
  it("turns the old answer-time choice into the new timers", () => {
    const long = sanitizeSettings({ answerTime: "long" });
    expect(long.readSeconds).toBeCloseTo(DEFAULT_SETTINGS.readSeconds * 1.5);
    expect(long.answerSeconds).toBeCloseTo(DEFAULT_SETTINGS.answerSeconds * 1.5);
    const very = sanitizeSettings({ answerTime: "veryLong" });
    expect(very.answerSeconds).toBeCloseTo(DEFAULT_SETTINGS.answerSeconds * 2);
    expect(sanitizeSettings({ answerTime: "normal" }).answerSeconds).toBe(DEFAULT_SETTINGS.answerSeconds);
  });

  it("prefers the new timers when both are present", () => {
    const s = sanitizeSettings({ answerTime: "veryLong", readSeconds: 2, answerSeconds: 4 });
    expect(s).toMatchObject({ readSeconds: 2, answerSeconds: 4 });
  });

  it("ignores an unknown old value", () => {
    expect(sanitizeSettings({ answerTime: "forever" })).toEqual(DEFAULT_SETTINGS);
  });
});

describe("loadSettings / saveSettings", () => {
  it("round-trips", () => {
    const store = memoryStore();
    const settings = { ...DEFAULT_SETTINGS, categories: ["math", "logic"], difficulty: "MEDIUM" as const, speed: "relaxed" as const, highContrast: true, sensitivity: "high" as const, answerSeconds: 12 };
    expect(saveSettings(store, settings)).toBe(true);
    expect(loadSettings(store, CATEGORIES)).toEqual(settings);
  });

  it("falls back to defaults with nothing saved, corrupt JSON or no storage", () => {
    expect(loadSettings(memoryStore(), CATEGORIES)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memoryStore({ [SETTINGS_STORAGE_KEY]: "{not json" }), CATEGORIES)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("fills fields missing from an older save", () => {
    const store = memoryStore({ [SETTINGS_STORAGE_KEY]: JSON.stringify({ speed: "fast" }) });
    expect(loadSettings(store)).toEqual({ ...DEFAULT_SETTINGS, speed: "fast" });
  });

  it("migrates a save that has the old answer-time field", () => {
    const store = memoryStore({ [SETTINGS_STORAGE_KEY]: JSON.stringify({ answerTime: "long", speed: "fast" }) });
    const s = loadSettings(store);
    expect(s.speed).toBe("fast");
    expect(s.answerSeconds).toBeCloseTo(DEFAULT_SETTINGS.answerSeconds * 1.5);
  });

  it("uses the supplied defaults (e.g. OS reduced-motion) only when nothing is saved", () => {
    expect(loadSettings(memoryStore(), undefined, { reducedMotion: true }).reducedMotion).toBe(true);
    const saved = memoryStore({ [SETTINGS_STORAGE_KEY]: JSON.stringify({ reducedMotion: false }) });
    expect(loadSettings(saved, undefined, { reducedMotion: true }).reducedMotion).toBe(false);
  });

  it("survives a store that throws", () => {
    const hostile: KeyValueStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(loadSettings(hostile)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(hostile, DEFAULT_SETTINGS)).toBe(false);
  });

  it("reports failure when there is no storage", () => {
    expect(saveSettings(null, DEFAULT_SETTINGS)).toBe(false);
  });
});

describe("applySettings", () => {
  it("leaves the defaults equivalent to the base config", () => {
    const cfg = applySettings(runner, DEFAULT_SETTINGS, presets);
    expect(cfg.speed).toEqual(runner.speed);
    expect(cfg.slowMotion.readMs).toBe(runner.slowMotion.readMs);
    expect(cfg.slowMotion.responseWindowMs).toBe(runner.slowMotion.responseWindowMs);
    expect(cfg.slowMotion.laneLockInMs).toBe(runner.slowMotion.laneLockInMs);
    expect(cfg.slowMotion.movementLockInMs).toBe(runner.slowMotion.movementLockInMs);
    expect(cfg.questions.difficulty.mode).toBe("progressive");
    expect(cfg.questions.categories).toBeNull();
  });

  it("applies the speed preset", () => {
    expect(applySettings(runner, { ...DEFAULT_SETTINGS, speed: "relaxed" }, presets).speed).toEqual(presets.speed.relaxed);
    expect(presets.speed.relaxed.travelTimeMs).toBeGreaterThan(presets.speed.fast.travelTimeMs);
  });

  it("sets the question timers in milliseconds, leaving the other slow-motion timings alone", () => {
    const cfg = applySettings(runner, { ...DEFAULT_SETTINGS, readSeconds: 3.5, answerSeconds: 11, lockInSeconds: 2.4 }, presets);
    expect(cfg.slowMotion.readMs).toBe(3500);
    expect(cfg.slowMotion.responseWindowMs).toBe(11000);
    expect(cfg.slowMotion.laneLockInMs).toBe(2400);
    expect(cfg.slowMotion.slowFactor).toBe(runner.slowMotion.slowFactor);
    expect(cfg.slowMotion.rampDownMs).toBe(runner.slowMotion.rampDownMs);
  });

  it("never lets the movement lock-in exceed the lane lock-in", () => {
    const cfg = applySettings(runner, { ...DEFAULT_SETTINGS, lockInSeconds: 0.5 }, presets);
    expect(cfg.slowMotion.movementLockInMs).toBe(500);
    const slow = applySettings(runner, { ...DEFAULT_SETTINGS, lockInSeconds: 5 }, presets);
    expect(slow.slowMotion.movementLockInMs).toBe(runner.slowMotion.movementLockInMs);
  });

  it("turns auto-lock off by making the lock-in unreachable", () => {
    const cfg = applySettings(runner, { ...DEFAULT_SETTINGS, autoLock: false }, presets);
    expect(cfg.slowMotion.laneLockInMs).toBe(Infinity);
    expect(cfg.slowMotion.movementLockInMs).toBe(Infinity);
  });

  it("applies a fixed difficulty and category filter", () => {
    const cfg = applySettings(runner, { ...DEFAULT_SETTINGS, difficulty: "HARD", categories: ["math"] }, presets);
    expect(cfg.questions.difficulty).toMatchObject({ mode: "fixed", fixed: "HARD" });
    expect(cfg.questions.categories).toEqual(["math"]);
  });

  it("does not mutate the base config", () => {
    const before = JSON.stringify(runner);
    applySettings(runner, { ...DEFAULT_SETTINGS, speed: "fast", difficulty: "EASY", answerSeconds: 9, autoLock: false, categories: ["math"] }, presets);
    expect(JSON.stringify(runner)).toBe(before);
  });
});
