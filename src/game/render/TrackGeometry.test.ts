import { describe, expect, it } from "vitest";
import { gameConfig } from "../../config/gameConfig";
import { LANE_COUNT, TrackGeometry } from "./TrackGeometry";

const view = gameConfig.runner.view;
const geo = new TrackGeometry(view);

describe("TrackGeometry", () => {
  it("maps depth to screen y between the horizon and the player line", () => {
    expect(geo.yAt(0)).toBeCloseTo(view.height * view.horizonY);
    expect(geo.yAt(1)).toBeCloseTo(view.height * view.playerY);
    expect(geo.yAt(0.5)).toBeCloseTo((geo.yAt(0) + geo.yAt(1)) / 2);
  });

  it("inverts yAt", () => {
    for (const t of [0, 0.25, 1, 1.3]) expect(geo.depthAtY(geo.yAt(t))).toBeCloseTo(t);
  });

  it("reaches the bottom of the screen at bottomDepth", () => {
    expect(geo.yAt(geo.bottomDepth)).toBeCloseTo(view.height);
    expect(geo.bottomDepth).toBeGreaterThan(1);
  });

  it("widens the track towards the player", () => {
    expect(geo.roadWidthAt(0)).toBeCloseTo(view.width * view.roadWidthTop);
    expect(geo.roadWidthAt(1)).toBeCloseTo(view.width * view.roadWidthBottom);
    expect(geo.roadWidthAt(0.6)).toBeGreaterThan(geo.roadWidthAt(0.3));
  });

  it("keeps the track centred", () => {
    for (const t of [0, 0.5, 1]) expect(geo.roadLeftAt(t) + geo.roadWidthAt(t) / 2).toBeCloseTo(view.width / 2);
  });

  it("places lane centres evenly, in order, inside the track", () => {
    const xs = [0, 1, 2].map((lane) => geo.laneX(lane, 0.7));
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
    expect(xs[1] - xs[0]).toBeCloseTo(xs[2] - xs[1]);
    expect(xs[1]).toBeCloseTo(view.width / 2);
    expect(xs[0]).toBeGreaterThan(geo.roadLeftAt(0.7));
    expect(xs[2]).toBeLessThan(geo.roadLeftAt(0.7) + geo.roadWidthAt(0.7));
  });

  it("supports fractional lanes for smooth lane changes", () => {
    expect(geo.laneX(0.5, 1)).toBeCloseTo((geo.laneX(0, 1) + geo.laneX(1, 1)) / 2);
  });

  it("puts the dividers between lanes and the edges at the road edges", () => {
    expect(geo.dividerX(0, 1)).toBeCloseTo(geo.roadLeftAt(1));
    expect(geo.dividerX(LANE_COUNT, 1)).toBeCloseTo(geo.roadLeftAt(1) + geo.roadWidthAt(1));
    expect(geo.dividerX(1, 1)).toBeCloseTo((geo.laneX(0, 1) + geo.laneX(1, 1)) / 2);
  });

  it("scales things from the minimum at the horizon to full size at the player", () => {
    expect(geo.scaleAt(0)).toBeCloseTo(view.obstacleMinScale);
    expect(geo.scaleAt(1)).toBeCloseTo(1);
  });
});
