import { describe, expect, it } from "vitest";
import { gameConfig } from "../config/gameConfig";
import { applySensitivity } from "./Sensitivity";

const movement = gameConfig.movement;
const presets = gameConfig.presets;

describe("applySensitivity", () => {
  it("leaves the thresholds alone at normal", () => {
    expect(applySensitivity(movement, "normal", presets)).toBe(movement);
  });

  it("asks for smaller, shorter movements at high", () => {
    const m = applySensitivity(movement, "high", presets);
    expect(m.jump.minimumDisplacement).toBeLessThan(movement.jump.minimumDisplacement);
    expect(m.crouch.enterDrop).toBeLessThan(movement.crouch.enterDrop);
    expect(m.crouch.exitDrop).toBeLessThan(movement.crouch.exitDrop);
    expect(m.crouch.minimumDurationMs).toBeLessThan(movement.crouch.minimumDurationMs);
    expect(m.lane.minStableMs).toBeLessThan(movement.lane.minStableMs);
  });

  it("asks for bigger, longer movements at low", () => {
    const m = applySensitivity(movement, "low", presets);
    expect(m.jump.minimumDisplacement).toBeGreaterThan(movement.jump.minimumDisplacement);
    expect(m.crouch.enterDrop).toBeGreaterThan(movement.crouch.enterDrop);
    expect(m.crouch.minimumDurationMs).toBeGreaterThan(movement.crouch.minimumDurationMs);
  });

  it("scales by exactly the preset factors", () => {
    const { threshold, time } = presets.sensitivity.high;
    const m = applySensitivity(movement, "high", presets);
    expect(m.jump.minimumDisplacement).toBeCloseTo(movement.jump.minimumDisplacement * threshold);
    expect(m.crouch.enterDrop).toBeCloseTo(movement.crouch.enterDrop * threshold);
    expect(m.crouch.minimumDurationMs).toBe(Math.round(movement.crouch.minimumDurationMs * time));
  });

  it("keeps the crouch exit level below the entry level", () => {
    for (const level of ["low", "normal", "high"] as const) {
      const m = applySensitivity(movement, level, presets);
      expect(m.crouch.exitDrop).toBeLessThan(m.crouch.enterDrop);
    }
  });

  it("does not move the lane boundaries or touch unrelated settings", () => {
    const m = applySensitivity(movement, "high", presets);
    expect(m.lane.thresholds).toEqual(movement.lane.thresholds);
    expect(m.baseline).toEqual(movement.baseline);
    expect(m.jump.cooldownMs).toBe(movement.jump.cooldownMs);
    expect(m.minPoseConfidence).toBe(movement.minPoseConfidence);
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(movement);
    applySensitivity(movement, "high", presets);
    expect(JSON.stringify(movement)).toBe(before);
  });

  it("orders the presets low < normal < high in sensitivity", () => {
    const s = presets.sensitivity;
    expect(s.low.threshold).toBeGreaterThan(s.normal.threshold);
    expect(s.normal.threshold).toBeGreaterThan(s.high.threshold);
  });
});
