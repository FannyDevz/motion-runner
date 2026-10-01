import { describe, expect, it } from "vitest";
import { gameConfig } from "../config/gameConfig";
import {
  CALIBRATION_STEPS,
  CALIBRATION_STORAGE_KEY,
  CalibrationSession,
  deriveMovementConfig,
  loadCalibration,
  parseCalibration,
  saveCalibration,
  type CalibrationFrame,
  type CalibrationMeasurements,
} from "./Calibration";
import type { KeyValueStore } from "./Settings";

const cal = gameConfig.input.calibration;
const movement = gameConfig.movement;
const FRAME_MS = 33;
const HIP_Y = 0.6;
const TORSO = 0.25;

/** A tiny driver that feeds synthetic frames to a session at ~30 fps. */
class Driver {
  readonly session = new CalibrationSession(cal);
  private t = 1000;

  frame(overrides: Partial<CalibrationFrame> = {}): void {
    this.session.update({ valid: true, timestamp: this.t, centerX: 0.5, hipY: HIP_Y, torsoLength: TORSO, ...overrides });
    this.t += FRAME_MS;
  }

  /** Feed `ms` of frames; `shape` may vary the frame over elapsed time. */
  hold(ms: number, shape: (elapsed: number) => Partial<CalibrationFrame> = () => ({})): void {
    for (let e = 0; e < ms; e += FRAME_MS) this.frame(shape(e));
  }

  /** Hip y for a rise (+) or drop (−) in torso lengths. */
  static hipFor(riseInTorsos: number): number {
    return HIP_Y - riseInTorsos * TORSO;
  }

  standStill(x = 0.5): void {
    this.hold(cal.standDurationMs + 200, () => ({ centerX: x }));
  }
}

function fullRun(d: Driver, opts: { x?: number; left?: number; right?: number; jump?: number; crouch?: number } = {}): void {
  const { x = 0.5, left = 0.2, right = 0.8, jump = 0.5, crouch = 0.4 } = opts;
  d.standStill(x);
  d.hold(cal.holdMs + 100, () => ({ centerX: left }));
  d.hold(cal.holdMs + 100, () => ({ centerX: right }));
  d.hold(200, () => ({ centerX: x, hipY: Driver.hipFor(jump) }));
  d.hold(200, () => ({ centerX: x }));
  d.hold(cal.holdMs + 100, () => ({ centerX: x, hipY: Driver.hipFor(-crouch) }));
}

describe("CalibrationSession steps", () => {
  it("starts on STAND with the other steps pending", () => {
    const { session } = new Driver();
    expect(session.step).toBe("STAND");
    expect(session.statusOf("STAND")).toBe("active");
    expect(session.statusOf("JUMP")).toBe("pending");
    expect(session.done).toBe(false);
  });

  it("completes STAND after the player has been still long enough", () => {
    const d = new Driver();
    d.hold(cal.standDurationMs - 300);
    expect(d.session.step).toBe("STAND");
    expect(d.session.progress).toBeGreaterThan(0.5);
    d.hold(600);
    expect(d.session.step).toBe("LEFT");
    expect(d.session.statusOf("STAND")).toBe("done");
  });

  it("restarts STAND if the player keeps moving about", () => {
    const d = new Driver();
    d.hold(cal.standDurationMs * 3, (e) => ({ centerX: 0.5 + (Math.floor(e / 200) % 2 === 0 ? 0 : 0.15) }));
    expect(d.session.step).toBe("STAND");
  });

  it("restarts STAND after a stretch with no player in view", () => {
    const d = new Driver();
    d.hold(cal.standDurationMs - 300);
    d.hold(cal.lostResetMs + 200, () => ({ valid: false }));
    d.hold(400);
    expect(d.session.step).toBe("STAND");
    expect(d.session.progress).toBeLessThan(0.5);
  });

  it("ignores a single dropped frame", () => {
    const d = new Driver();
    d.hold(500);
    d.frame({ valid: false });
    d.hold(cal.standDurationMs);
    expect(d.session.step).toBe("LEFT");
  });

  it("records LEFT and RIGHT only when held at a clear shift", () => {
    const d = new Driver();
    d.standStill();
    d.hold(cal.holdMs * 3, () => ({ centerX: 0.5 - cal.laneShiftMin / 2 })); // too small a move
    expect(d.session.step).toBe("LEFT");
    d.hold(cal.holdMs - 100, () => ({ centerX: 0.25 })); // not held long enough
    d.hold(200, () => ({ centerX: 0.5 })); // back to centre resets the hold
    expect(d.session.step).toBe("LEFT");
    d.hold(cal.holdMs + 100, () => ({ centerX: 0.25 }));
    expect(d.session.step).toBe("RIGHT");
    d.hold(cal.holdMs + 100, () => ({ centerX: 0.75 }));
    expect(d.session.step).toBe("JUMP");
  });

  it("does not accept the wrong direction", () => {
    const d = new Driver();
    d.standStill();
    d.hold(cal.holdMs * 3, () => ({ centerX: 0.8 })); // moving right during the LEFT step
    expect(d.session.step).toBe("LEFT");
  });

  it("completes JUMP when the hip rises and comes back down, keeping the peak", () => {
    const d = new Driver();
    d.standStill();
    d.hold(cal.holdMs + 100, () => ({ centerX: 0.2 }));
    d.hold(cal.holdMs + 100, () => ({ centerX: 0.8 }));
    d.hold(100, () => ({ hipY: Driver.hipFor(0.2) }));
    expect(d.session.step).toBe("JUMP"); // airborne, not landed yet
    d.hold(100, () => ({ hipY: Driver.hipFor(0.45) }));
    d.hold(100, () => ({ hipY: Driver.hipFor(0.2) }));
    d.hold(100);
    expect(d.session.step).toBe("CROUCH");
    expect(d.session.statusOf("JUMP")).toBe("done");
  });

  it("ignores a hip rise smaller than a jump", () => {
    const d = new Driver();
    d.standStill();
    d.hold(cal.holdMs + 100, () => ({ centerX: 0.2 }));
    d.hold(cal.holdMs + 100, () => ({ centerX: 0.8 }));
    d.hold(500, () => ({ hipY: Driver.hipFor(cal.jumpMinPeak / 2) }));
    expect(d.session.step).toBe("JUMP");
  });

  it("completes CROUCH only after a sustained drop", () => {
    const d = new Driver();
    d.standStill();
    d.hold(cal.holdMs + 100, () => ({ centerX: 0.2 }));
    d.hold(cal.holdMs + 100, () => ({ centerX: 0.8 }));
    d.hold(200, () => ({ hipY: Driver.hipFor(0.4) }));
    d.hold(200);
    expect(d.session.step).toBe("CROUCH");
    d.hold(cal.holdMs / 2, () => ({ hipY: Driver.hipFor(-0.3) }));
    d.hold(100); // stood up again: hold resets
    expect(d.session.step).toBe("CROUCH");
    d.hold(cal.holdMs + 100, () => ({ hipY: Driver.hipFor(-0.3) }));
    expect(d.session.done).toBe(true);
  });

  it("runs all five steps and reports the measurements", () => {
    const d = new Driver();
    fullRun(d, { x: 0.48, left: 0.2, right: 0.78, jump: 0.5, crouch: 0.4 });
    expect(d.session.done).toBe(true);
    expect(CALIBRATION_STEPS.map((s) => d.session.statusOf(s))).toEqual(Array(5).fill("done"));

    const result = d.session.result(123);
    expect(result).toMatchObject({ version: 1, createdAt: 123 });
    expect(result?.standX).toBeCloseTo(0.48, 2);
    expect(result?.hipY).toBeCloseTo(HIP_Y, 2);
    expect(result?.torsoLength).toBeCloseTo(TORSO, 2);
    expect(result?.leftX).toBeLessThan(0.3);
    expect(result?.rightX).toBeGreaterThan(0.7);
    expect(result?.jumpPeak).toBeCloseTo(0.5, 1);
    expect(result?.crouchDrop).toBeCloseTo(0.4, 1);
  });

  it("has no result before it is finished", () => {
    const d = new Driver();
    d.standStill();
    expect(d.session.result(0)).toBeNull();
  });
});

describe("hints", () => {
  /** Reaches the LEFT step. */
  function atLeftStep(): Driver {
    const d = new Driver();
    d.standStill();
    return d;
  }

  it("says nothing before the player has moved", () => {
    const d = atLeftStep();
    d.hold(300);
    expect(d.session.needsMore).toBe(false);
  });

  it("asks for a bit more when the player moves the right way but not far enough", () => {
    const d = atLeftStep();
    const shift = cal.laneShiftMin * 0.6; // part of the way
    d.hold(300, () => ({ centerX: 0.5 - shift }));
    expect(d.session.step).toBe("LEFT");
    expect(d.session.needsMore).toBe(true);
  });

  it("does not nag for a tiny movement, or the wrong direction", () => {
    const tiny = atLeftStep();
    tiny.hold(300, () => ({ centerX: 0.5 - cal.laneShiftMin * 0.1 }));
    expect(tiny.session.needsMore).toBe(false);
    const wrong = atLeftStep();
    wrong.hold(300, () => ({ centerX: 0.7 }));
    expect(wrong.session.needsMore).toBe(false);
  });

  it("clears once the step is done", () => {
    const d = atLeftStep();
    d.hold(200, () => ({ centerX: 0.5 - cal.laneShiftMin * 0.6 }));
    expect(d.session.needsMore).toBe(true);
    d.hold(cal.holdMs + 100, () => ({ centerX: 0.2 }));
    expect(d.session.step).toBe("RIGHT");
    expect(d.session.needsMore).toBe(false);
  });

  it("asks for a higher jump and a deeper crouch when they fall short", () => {
    const d = new Driver();
    d.standStill();
    d.session.skip(); // LEFT
    d.session.skip(); // RIGHT
    expect(d.session.step).toBe("JUMP");
    d.hold(200, () => ({ hipY: Driver.hipFor(cal.jumpMinPeak * 0.6) }));
    expect(d.session.needsMore).toBe(true);
    d.hold(200); // back down: nothing to say
    expect(d.session.needsMore).toBe(false);

    d.session.skip(); // JUMP
    expect(d.session.step).toBe("CROUCH");
    d.hold(300, () => ({ hipY: Driver.hipFor(-cal.crouchMinDrop * 0.6) }));
    expect(d.session.needsMore).toBe(true);
  });

  it("stops hinting when the player leaves the frame", () => {
    const d = atLeftStep();
    d.hold(200, () => ({ centerX: 0.5 - cal.laneShiftMin * 0.6 }));
    d.hold(100, () => ({ valid: false }));
    expect(d.session.needsMore).toBe(false);
  });
});

describe("skipping", () => {
  it("cannot skip STAND", () => {
    const d = new Driver();
    expect(d.session.skip()).toBe(false);
    expect(d.session.step).toBe("STAND");
  });

  it("skips later steps and leaves their measurements empty", () => {
    const d = new Driver();
    d.standStill();
    expect(d.session.skip()).toBe(true); // LEFT
    expect(d.session.skip()).toBe(true); // RIGHT
    expect(d.session.skip()).toBe(true); // JUMP
    expect(d.session.skip()).toBe(true); // CROUCH
    expect(d.session.done).toBe(true);
    expect(d.session.statusOf("LEFT")).toBe("skipped");
    expect(d.session.result(1)).toMatchObject({ leftX: null, rightX: null, jumpPeak: null, crouchDrop: null });
  });
});

describe("deriveMovementConfig", () => {
  const measured: CalibrationMeasurements = { standX: 0.5, hipY: HIP_Y, torsoLength: TORSO, leftX: 0.2, rightX: 0.8, jumpPeak: 0.5, crouchDrop: 0.4 };

  it("puts the lane boundaries between standing and the measured extremes", () => {
    const { lane } = deriveMovementConfig(movement, measured, cal);
    expect(lane.thresholds.left).toBeCloseTo(0.35);
    expect(lane.thresholds.right).toBeCloseTo(0.65);
  });

  it("centres the CENTER lane on where the player stands", () => {
    const { lane } = deriveMovementConfig(movement, { ...measured, standX: 0.4, leftX: 0.15, rightX: 0.65 }, cal);
    expect((lane.thresholds.left + lane.thresholds.right) / 2).toBeCloseTo(0.4);
  });

  it("handles an asymmetric reach (a short step one way, a long step the other)", () => {
    const { lane } = deriveMovementConfig(movement, { ...measured, leftX: 0.4, rightX: 0.9 }, cal);
    expect(lane.thresholds.left).toBeCloseTo(0.45);
    expect(lane.thresholds.right).toBeCloseTo(0.7);
  });

  it("assumes the other side is as wide when only one is measured", () => {
    const { lane } = deriveMovementConfig(movement, { ...measured, rightX: null }, cal);
    expect(lane.thresholds.left).toBeCloseTo(0.35);
    expect(lane.thresholds.right).toBeCloseTo(0.65);
  });

  it("shifts the default thresholds to the standing position when no sideways step was measured", () => {
    const { lane } = deriveMovementConfig(movement, { ...measured, standX: 0.6, leftX: null, rightX: null }, cal);
    expect(lane.thresholds.left).toBeCloseTo(movement.lane.thresholds.left + 0.1);
    expect(lane.thresholds.right).toBeCloseTo(movement.lane.thresholds.right + 0.1);
  });

  it("never lets the CENTER lane get narrower than the minimum", () => {
    const tiny = deriveMovementConfig(movement, { ...measured, leftX: 0.46, rightX: 0.54 }, cal).lane.thresholds;
    expect(tiny.right - tiny.left).toBeGreaterThanOrEqual(cal.minLaneGap - 1e-9);
  });

  it("keeps the thresholds inside the image and ordered", () => {
    const { lane } = deriveMovementConfig(movement, { ...measured, standX: 0.95, leftX: 0.7, rightX: 1 }, cal);
    expect(lane.thresholds.left).toBeGreaterThanOrEqual(0.05);
    expect(lane.thresholds.right).toBeLessThanOrEqual(0.95);
    expect(lane.thresholds.left).toBeLessThan(lane.thresholds.right);
  });

  it("scales the jump threshold to the measured jump, within limits", () => {
    const at = (peak: number) => deriveMovementConfig(movement, { ...measured, jumpPeak: peak }, cal).jump.minimumDisplacement;
    expect(at(0.5)).toBeCloseTo(0.5 * cal.jumpThresholdFraction);
    expect(at(0.1)).toBe(cal.jumpThresholdMin);
    expect(at(2)).toBe(cal.jumpThresholdMax);
  });

  it("scales the crouch thresholds, keeping the exit below the entry", () => {
    const c = deriveMovementConfig(movement, measured, cal).crouch;
    const enter = 0.4 * cal.crouchEnterFraction; // measured drop of 0.4 torso lengths
    expect(c.enterDrop).toBeCloseTo(enter);
    expect(c.exitDrop).toBeCloseTo(enter * cal.crouchExitFraction);
    expect(c.exitDrop).toBeLessThan(c.enterDrop);
    expect(deriveMovementConfig(movement, { ...measured, crouchDrop: 0.05 }, cal).crouch.enterDrop).toBe(cal.crouchEnterMin);
  });

  it("keeps the defaults for skipped jump and crouch", () => {
    const cfg = deriveMovementConfig(movement, { ...measured, jumpPeak: null, crouchDrop: null }, cal);
    expect(cfg.jump.minimumDisplacement).toBe(movement.jump.minimumDisplacement);
    expect(cfg.crouch.enterDrop).toBe(movement.crouch.enterDrop);
    expect(cfg.crouch.exitDrop).toBe(movement.crouch.exitDrop);
  });

  it("leaves everything else untouched and does not mutate the base", () => {
    const before = JSON.stringify(movement);
    const cfg = deriveMovementConfig(movement, measured, cal);
    expect(JSON.stringify(movement)).toBe(before);
    expect(cfg.jump.cooldownMs).toBe(movement.jump.cooldownMs);
    expect(cfg.baseline).toEqual(movement.baseline);
    expect(cfg.minPoseConfidence).toBe(movement.minPoseConfidence);
  });
});

describe("storage", () => {
  const result = { version: 1 as const, createdAt: 5, standX: 0.5, hipY: 0.6, torsoLength: 0.25, leftX: 0.2, rightX: 0.8, jumpPeak: 0.5, crouchDrop: null };

  function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
    const data = { ...initial };
    return { getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
  }

  it("round-trips", () => {
    const store = memoryStore();
    expect(saveCalibration(store, result)).toBe(true);
    expect(loadCalibration(store)).toEqual(result);
  });

  it("returns null when nothing usable is stored", () => {
    expect(loadCalibration(memoryStore())).toBeNull();
    expect(loadCalibration(memoryStore({ [CALIBRATION_STORAGE_KEY]: "{oops" }))).toBeNull();
    expect(loadCalibration(null)).toBeNull();
  });

  it("rejects invalid data", () => {
    expect(parseCalibration(null)).toBeNull();
    expect(parseCalibration({ ...result, version: 2 })).toBeNull();
    expect(parseCalibration({ ...result, standX: 3 })).toBeNull();
    expect(parseCalibration({ ...result, torsoLength: 0 })).toBeNull();
    expect(parseCalibration({ ...result, leftX: "left" })).toBeNull();
    expect(parseCalibration({ ...result, hipY: NaN })).toBeNull();
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
    expect(loadCalibration(hostile)).toBeNull();
    expect(saveCalibration(hostile, result)).toBe(false);
  });
});
