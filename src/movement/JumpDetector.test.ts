import { describe, expect, it } from "vitest";
import { gameConfig } from "../config/gameConfig";
import { JumpDetector, type JumpResult } from "./JumpDetector";

const cfg = gameConfig.movement.jump;
const FRAME_MS = 33;

/** Feeds a displacement series (torso units) at ~30 fps and collects jump results. */
function run(detector: JumpDetector, series: number[], startAt = 0, confidence = 0.95): JumpResult[] {
  const results: JumpResult[] = [];
  series.forEach((d, i) => {
    const r = detector.update(startAt + i * FRAME_MS, d, confidence);
    if (r) results.push(r);
  });
  return results;
}

const standing = (n: number): number[] => Array<number>(n).fill(0);
const airborne = (n: number, height = 0.4): number[] => Array<number>(n).fill(height);

describe("JumpDetector", () => {
  it("reports the jump at take-off, while the player is still in the air", () => {
    const d = new JumpDetector(cfg);
    const results = run(d, [...standing(5), ...airborne(4)]);
    expect(results).toHaveLength(1);
    expect(d.state).toBe("AIRBORNE"); // not landed yet
  });

  it("reports the jump within about confirmMs of the rise starting", () => {
    const d = new JumpDetector(cfg);
    run(d, standing(5));
    const start = 5 * FRAME_MS; // continues straight after the standing frames
    let at = -1;
    airborne(10).forEach((x, i) => {
      if (d.update(start + i * FRAME_MS, x, 0.95) && at < 0) at = i * FRAME_MS;
    });
    expect(at).toBeGreaterThanOrEqual(cfg.confirmMs);
    expect(at).toBeLessThanOrEqual(cfg.confirmMs + FRAME_MS);
  });

  it("drops a rise that ends before it can be confirmed (two-frame noise)", () => {
    const d = new JumpDetector(cfg);
    expect(run(d, [...standing(5), 0.5, 0.5, 0, 0, 0])).toHaveLength(0);
    expect(d.state).toBe("GROUNDED");
  });

  it("detects a full jump cycle and reports the peak", () => {
    const d = new JumpDetector(cfg);
    const results = run(d, [...standing(5), 0.1, 0.3, 0.45, 0.3, 0.1, 0, 0]);
    expect(results).toHaveLength(1);
    expect(results[0].peakDisplacement).toBeCloseTo(0.45);
    expect(results[0].confidence).toBeCloseTo(0.95);
  });

  it("does not report a jump below the minimum displacement", () => {
    const d = new JumpDetector(cfg);
    expect(run(d, [...standing(5), 0.1, 0.12, 0.15, 0.1, 0, 0])).toHaveLength(0);
    expect(d.state).toBe("GROUNDED");
  });

  it("ignores a single-frame spike (noise)", () => {
    const d = new JumpDetector(cfg);
    expect(run(d, [...standing(5), 0.5, 0, 0, 0])).toHaveLength(0);
  });

  it("ignores a slow rise such as walking closer or baseline drift", () => {
    const d = new JumpDetector(cfg);
    // About 0.25 torso lengths per second: far slower than a real jump.
    const slow = Array.from({ length: 60 }, (_, i) => i * 0.008);
    expect(run(d, [...standing(5), ...slow, ...standing(5)])).toHaveLength(0);
  });

  it("reports a sudden rise once, and does not report it again while it is held", () => {
    const d = new JumpDetector(cfg);
    const frames = Math.ceil(cfg.maxAirTimeMs / FRAME_MS) + 5;
    expect(run(d, [...standing(5), ...airborne(frames), ...standing(5)])).toHaveLength(1);
    expect(d.state).not.toBe("AIRBORNE");
  });

  it("needs a return to the ground after a held rise before the next jump", () => {
    const d = new JumpDetector(cfg);
    const frames = Math.ceil(cfg.maxAirTimeMs / FRAME_MS) + 5;
    run(d, [...standing(5), ...airborne(frames)]);
    // Still up there: no new jump from bouncing around at that height.
    expect(run(d, [0.5, 0.2, 0.5, 0.2, 0.5], 9000)).toHaveLength(0);
  });

  it("does not report two jumps for one physical jump", () => {
    const d = new JumpDetector(cfg);
    const wobble = [...standing(5), ...airborne(5), 0, 0.3, 0.3, 0, 0];
    expect(run(d, wobble)).toHaveLength(1);
  });

  it("allows another jump after the cooldown", () => {
    const d = new JumpDetector(cfg);
    const one = [...standing(5), ...airborne(5), 0, 0];
    expect(run(d, one)).toHaveLength(1);
    const later = 5000;
    const second = run(d, [...standing(10), ...airborne(5), 0, 0], later);
    expect(second).toHaveLength(1);
  });

  it("ignores low-confidence frames when starting a jump", () => {
    const d = new JumpDetector(cfg);
    const results = run(d, [...standing(5), ...airborne(5), 0, 0], 0, 0.2);
    expect(results).toHaveLength(0);
  });
});
