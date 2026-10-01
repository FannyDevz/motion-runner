import { describe, expect, it } from "vitest";
import { gameConfig } from "../config/gameConfig";
import { LaneDetector, detectLane } from "./LaneDetector";

const { lane } = gameConfig.movement;

describe("detectLane", () => {
  it("maps x into three lanes using thresholds", () => {
    expect(detectLane(0.1, null, lane.thresholds, 0)).toBe("LEFT");
    expect(detectLane(0.5, null, lane.thresholds, 0)).toBe("CENTER");
    expect(detectLane(0.9, null, lane.thresholds, 0)).toBe("RIGHT");
  });

  it("applies hysteresis around the current lane", () => {
    const justPastLeft = lane.thresholds.left + 0.01;
    expect(detectLane(justPastLeft, null, lane.thresholds, 0.03)).toBe("CENTER");
    expect(detectLane(justPastLeft, "LEFT", lane.thresholds, 0.03)).toBe("LEFT");
    expect(detectLane(lane.thresholds.left - 0.01, "CENTER", lane.thresholds, 0.03)).toBe("CENTER");
  });

  it("respects custom thresholds", () => {
    expect(detectLane(0.45, null, { left: 0.4, right: 0.6 }, 0)).toBe("CENTER");
    expect(detectLane(0.35, null, { left: 0.4, right: 0.6 }, 0)).toBe("LEFT");
  });
});

describe("LaneDetector", () => {
  const config = { ...lane, smoothing: 1, minStableMs: 100 };

  it("reports the initial lane immediately", () => {
    const d = new LaneDetector(config);
    expect(d.update(0, 0.5)).toBe("CENTER");
  });

  it("requires the new lane to be stable before switching", () => {
    const d = new LaneDetector(config);
    d.update(0, 0.5);
    expect(d.update(10, 0.9)).toBeNull();
    expect(d.update(60, 0.9)).toBeNull();
    expect(d.update(120, 0.9)).toBe("RIGHT");
    expect(d.lane).toBe("RIGHT");
  });

  it("ignores a brief excursion into another lane", () => {
    const d = new LaneDetector(config);
    d.update(0, 0.5);
    d.update(10, 0.9);
    expect(d.update(50, 0.5)).toBeNull();
    expect(d.update(200, 0.5)).toBeNull();
    expect(d.lane).toBe("CENTER");
  });

  it("smooths noisy x values", () => {
    const d = new LaneDetector({ ...config, smoothing: 0.2 });
    d.update(0, 0.5);
    d.update(10, 0.9);
    expect(d.smoothedX).toBeCloseTo(0.58, 5);
  });
});
