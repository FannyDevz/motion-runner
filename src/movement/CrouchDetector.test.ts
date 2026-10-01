import { describe, expect, it } from "vitest";
import { gameConfig } from "../config/gameConfig";
import { CrouchDetector, isLowered, isStanding, type CrouchSignals, type CrouchTransition } from "./CrouchDetector";

const cfg = gameConfig.movement.crouch;
const FRAME_MS = 33;

function run(detector: CrouchDetector, signals: CrouchSignals[], startAt = 0, confidence = 0.95): CrouchTransition[] {
  const out: CrouchTransition[] = [];
  signals.forEach((s, i) => {
    const t = detector.update(startAt + i * FRAME_MS, s, confidence);
    if (t) out.push(t);
  });
  return out;
}

const stand: CrouchSignals = { hipDrop: 0, kneeAngleDeg: 170 };
const deep: CrouchSignals = { hipDrop: 0.4, kneeAngleDeg: 90 };
const repeat = (s: CrouchSignals, n: number): CrouchSignals[] => Array<CrouchSignals>(n).fill(s);
const framesFor = (ms: number): number => Math.ceil(ms / FRAME_MS) + 2;

describe("isLowered / isStanding", () => {
  it("lowers on a large hip drop alone", () => {
    expect(isLowered({ hipDrop: cfg.enterDrop, kneeAngleDeg: null }, cfg)).toBe(true);
  });

  it("lets a bent knee compensate for a smaller hip drop", () => {
    const drop = cfg.enterDrop * cfg.kneeAssistRatio + 0.01;
    expect(isLowered({ hipDrop: drop, kneeAngleDeg: 100 }, cfg)).toBe(true);
    expect(isLowered({ hipDrop: drop, kneeAngleDeg: 170 }, cfg)).toBe(false);
    expect(isLowered({ hipDrop: drop, kneeAngleDeg: null }, cfg)).toBe(false);
  });

  it("has a hysteresis band between enter and exit", () => {
    const mid = (cfg.enterDrop + cfg.exitDrop) / 2;
    expect(isLowered({ hipDrop: mid, kneeAngleDeg: 170 }, cfg)).toBe(false);
    expect(isStanding({ hipDrop: mid, kneeAngleDeg: 170 }, cfg)).toBe(false);
  });
});

describe("CrouchDetector", () => {
  it("passes through LOWERING before confirming CROUCHING", () => {
    const d = new CrouchDetector(cfg);
    run(d, [stand]);
    expect(d.state).toBe("STANDING");
    run(d, [deep], 100);
    expect(d.state).toBe("LOWERING");
    expect(run(d, repeat(deep, framesFor(cfg.minimumDurationMs)), 200)).toEqual(["CROUCH_START"]);
    expect(d.state).toBe("CROUCHING");
  });

  it("does not confirm a brief dip", () => {
    const d = new CrouchDetector(cfg);
    const events = run(d, [...repeat(deep, 3), ...repeat(stand, 20)]);
    expect(events).toEqual([]);
    expect(d.state).toBe("STANDING");
  });

  it("emits CROUCH_START only once while the crouch is held", () => {
    const d = new CrouchDetector(cfg);
    const events = run(d, repeat(deep, framesFor(cfg.minimumDurationMs) * 3));
    expect(events).toEqual(["CROUCH_START"]);
  });

  it("stays crouched inside the hysteresis band", () => {
    const d = new CrouchDetector(cfg);
    run(d, repeat(deep, framesFor(cfg.minimumDurationMs)));
    const band: CrouchSignals = { hipDrop: (cfg.enterDrop + cfg.exitDrop) / 2, kneeAngleDeg: 150 };
    const events = run(d, repeat(band, 30), 5000);
    expect(events).toEqual([]);
    expect(d.state).toBe("CROUCHING");
  });

  it("returns to STANDING only after standing is held", () => {
    const d = new CrouchDetector(cfg);
    run(d, repeat(deep, framesFor(cfg.minimumDurationMs)));
    const events = run(d, repeat(stand, framesFor(cfg.exitDurationMs)), 5000);
    expect(events).toEqual(["CROUCH_END"]);
    expect(d.state).toBe("STANDING");
  });

  it("ignores a brief stand-up while crouching", () => {
    const d = new CrouchDetector(cfg);
    run(d, repeat(deep, framesFor(cfg.minimumDurationMs)));
    run(d, repeat(stand, 2), 5000);
    run(d, repeat(deep, 5), 5100);
    expect(d.state).toBe("CROUCHING");
  });

  it("does not start lowering on low-confidence frames", () => {
    const d = new CrouchDetector(cfg);
    run(d, repeat(deep, 30), 0, 0.1);
    expect(d.state).toBe("STANDING");
  });
});
