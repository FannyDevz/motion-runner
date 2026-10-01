import { beforeEach, describe, expect, it } from "vitest";
import { gameConfig } from "../config/gameConfig";
import { BodyBaseline } from "./BodyBaseline";
import { MovementDetector } from "./MovementDetector";
import type { MovementEvent } from "./MovementTypes";
import { extractPoseFeatures, createPoseFeatures, jointAngleDeg } from "./PoseFeatures";
import { makePose, type SyntheticPoseOptions } from "./testing/poseFactory";

const FRAME_MS = 33;
const BASE_HIP_Y = 0.6;
const TORSO = 0.25;
const ASPECT = 16 / 9;

class Harness {
  readonly events: MovementEvent[] = [];
  readonly detector = new MovementDetector(gameConfig.movement, gameConfig.pose.minLandmarkVisibility, ASPECT);
  private t = 0;

  constructor() {
    this.detector.on("movement", (e) => this.events.push(e));
  }

  /** Feed `frames` frames, optionally as a function of the frame index. */
  feed(frames: number, options: SyntheticPoseOptions | ((i: number) => SyntheticPoseOptions) = {}): void {
    for (let i = 0; i < frames; i++) {
      const o = typeof options === "function" ? options(i) : options;
      this.detector.update(makePose({ hipY: BASE_HIP_Y, torsoLength: TORSO, ...o, timestamp: this.t }));
      this.t += FRAME_MS;
    }
  }

  get movements(): string[] {
    return this.events.map((e) => e.movement);
  }

  /** Torso units → hip y for a given displacement (positive = up). */
  static hipYFor(displacement: number): number {
    return BASE_HIP_Y - displacement * TORSO;
  }
}

describe("MovementDetector", () => {
  let h: Harness;

  beforeEach(() => {
    h = new Harness();
  });

  it("reports the starting lane once", () => {
    h.feed(30, { x: 0.5 });
    expect(h.movements).toEqual(["CENTER"]);
  });

  it("emits lane changes when the player moves", () => {
    h.feed(30, { x: 0.5 });
    h.feed(15, { x: 0.15 });
    h.feed(15, { x: 0.85 });
    expect(h.movements).toEqual(["CENTER", "LEFT", "RIGHT"]);
  });

  it("does not detect jumps or crouches before the baseline warms up", () => {
    const warmup = gameConfig.movement.baseline.warmupSamples;
    h.feed(warmup - 2, { hipY: Harness.hipYFor(0.5) });
    expect(h.movements.filter((m) => m === "JUMP" || m === "CROUCH")).toEqual([]);
    expect(h.detector.snapshot().baselineReady).toBe(false);
  });

  it("emits JUMP after a rise and landing", () => {
    h.feed(30);
    h.feed(8, { hipY: Harness.hipYFor(0.4) });
    h.feed(10);
    expect(h.movements).toEqual(["CENTER", "JUMP"]);
    expect(h.events[1].confidence).toBeGreaterThan(0.6);
  });

  it("emits CROUCH when the player lowers and holds", () => {
    h.feed(30);
    h.feed(20, { hipY: Harness.hipYFor(-0.4), kneeOffset: 0.08 });
    expect(h.movements).toEqual(["CENTER", "CROUCH"]);
    expect(h.detector.snapshot().crouchState).toBe("CROUCHING");
  });

  it("does not report a crouch as a jump, nor a jump as a crouch", () => {
    h.feed(30);
    h.feed(8, { hipY: Harness.hipYFor(0.4) });
    h.feed(2, { hipY: Harness.hipYFor(-0.4) });
    h.feed(10);
    expect(h.movements).not.toContain("CROUCH");
  });

  it("ignores low-confidence frames entirely", () => {
    h.feed(30);
    const before = h.events.length;
    h.feed(40, { visibility: 0.3, x: 0.1 });
    expect(h.events.length).toBe(before);
  });

  it("ignores frames with no person detected", () => {
    h.feed(30);
    const before = h.events.length;
    h.feed(40, { detected: false });
    expect(h.events.length).toBe(before);
    expect(h.detector.snapshot().tracking).toBe(false);
  });

  it("recovers after tracking is lost", () => {
    h.feed(30, { x: 0.5 });
    h.feed(40, { detected: false });
    h.feed(5, { x: 0.15 });
    expect(h.movements.at(-1)).toBe("LEFT");
  });

  it("exposes confidence and timestamp on events", () => {
    h.feed(30, { visibility: 0.9 });
    expect(h.events[0]).toMatchObject({ movement: "CENTER", confidence: expect.closeTo(0.9, 5) });
    expect(typeof h.events[0].timestamp).toBe("number");
  });

  it("stops notifying after unsubscribe", () => {
    const received: MovementEvent[] = [];
    const off = h.detector.on("movement", (e) => received.push(e));
    off();
    h.feed(30);
    expect(received).toHaveLength(0);
  });
});

describe("baseline that follows the player", () => {
  let h: Harness;

  beforeEach(() => {
    h = new Harness();
  });

  it("still detects jumps after the player settles slightly higher than at calibration", () => {
    h.feed(30);
    // Stands a little taller (0.12 torso lengths): inside the "neither grounded nor a jump" zone.
    h.feed(120, { hipY: Harness.hipYFor(0.12) });
    h.feed(8, { hipY: Harness.hipYFor(0.12 + 0.4) });
    h.feed(10, { hipY: Harness.hipYFor(0.12) });
    expect(h.movements).toContain("JUMP");
  });

  it("still detects crouches after the player settles slightly lower than at calibration", () => {
    h.feed(30);
    h.feed(120, { hipY: Harness.hipYFor(-0.12) });
    h.feed(20, { hipY: Harness.hipYFor(-0.12 - 0.4), kneeOffset: 0.1 });
    expect(h.movements).toContain("CROUCH");
  });

  it("copes with the player stepping back from the camera (smaller, lower in the frame)", () => {
    h.feed(30);
    h.feed(150, { hipY: BASE_HIP_Y + 0.05, torsoLength: TORSO * 0.85 });
    // Now jump, measured against the new, smaller body.
    h.feed(8, { hipY: BASE_HIP_Y + 0.05 - 0.4 * TORSO * 0.85, torsoLength: TORSO * 0.85 });
    h.feed(10, { hipY: BASE_HIP_Y + 0.05, torsoLength: TORSO * 0.85 });
    expect(h.movements).toContain("JUMP");
  });

  it("does not let a held crouch teach the baseline that the player is standing", () => {
    h.feed(30);
    h.feed(40, { hipY: Harness.hipYFor(-0.4), kneeOffset: 0.1 }); // crouching for ~1.3 s
    expect(h.detector.snapshot().crouchState).toBe("CROUCHING");
    expect(h.detector.snapshot().displacement).toBeLessThan(-0.3);
  });

  it("reports a jump while the player is still in the air", () => {
    h.feed(30);
    h.feed(6, { hipY: Harness.hipYFor(0.4) }); // only ~200 ms of the jump so far
    expect(h.movements).toContain("JUMP");
  });
});

describe("PoseFeatures", () => {
  it("computes knee angle: straight vs bent", () => {
    const straight = makePose({ kneeOffset: 0 });
    const bent = makePose({ kneeOffset: 0.15 });
    const f = createPoseFeatures();
    const min = gameConfig.pose.minLandmarkVisibility;
    extractPoseFeatures(straight, min, 0.6, ASPECT, f);
    const straightAngle = f.kneeAngleDeg ?? 0;
    extractPoseFeatures(bent, min, 0.6, ASPECT, f);
    expect(straightAngle).toBeGreaterThan(170);
    expect(f.kneeAngleDeg ?? 180).toBeLessThan(150);
  });

  it("is invalid when a torso landmark is not visible", () => {
    const pose = makePose();
    pose.landmarks[23].visibility = 0.1;
    const f = extractPoseFeatures(pose, 0.5, 0.6, ASPECT, createPoseFeatures());
    expect(f.valid).toBe(false);
  });

  it("jointAngleDeg returns 90 for a right angle", () => {
    const a = { x: 0, y: 1, z: 0, visibility: 1 };
    const b = { x: 0, y: 0, z: 0, visibility: 1 };
    const c = { x: 1, y: 0, z: 0, visibility: 1 };
    expect(jointAngleDeg(a, b, c, 1)).toBeCloseTo(90);
  });
});

describe("BodyBaseline", () => {
  const cfg = gameConfig.movement.baseline;

  it("becomes ready after the warm-up samples and averages them", () => {
    const b = new BodyBaseline(cfg);
    for (let i = 0; i < cfg.warmupSamples; i++) b.update(0.6, 0.25, true);
    expect(b.ready).toBe(true);
    expect(b.hipY).toBeCloseTo(0.6);
    expect(b.displacement(0.5)).toBeCloseTo(0.4);
  });

  it("does not adapt while the player is far from the baseline", () => {
    const b = new BodyBaseline(cfg);
    for (let i = 0; i < cfg.warmupSamples; i++) b.update(0.6, 0.25, true);
    for (let i = 0; i < 50; i++) b.update(0.3, 0.25, true);
    expect(b.hipY).toBeCloseTo(0.6);
  });

  it("does not adapt when adaptation is disabled", () => {
    const b = new BodyBaseline(cfg);
    for (let i = 0; i < cfg.warmupSamples; i++) b.update(0.6, 0.25, true);
    for (let i = 0; i < 50; i++) b.update(0.61, 0.25, false);
    expect(b.hipY).toBeCloseTo(0.6);
  });

  it("slowly follows small standing drift", () => {
    const b = new BodyBaseline(cfg);
    for (let i = 0; i < cfg.warmupSamples; i++) b.update(0.6, 0.25, true);
    for (let i = 0; i < 200; i++) b.update(0.61, 0.25, true);
    expect(b.hipY).toBeGreaterThan(0.605);
  });
});
