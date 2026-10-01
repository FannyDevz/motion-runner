import { describe, expect, it } from "vitest";
import { gameConfig } from "../config/gameConfig";
import { LAYOUT_RULES, computeLayout, gameColumnWidth, type LayoutMode } from "./layout";

const cases: Array<[string, number, number, LayoutMode]> = [
  ["desktop 1920×1080", 1920, 1080, "wide"],
  ["laptop 1280×720", 1280, 720, "wide"],
  ["small laptop 1024×600", 1024, 600, "wide"],
  ["tablet landscape 1024×768", 1024, 768, "wide"],
  ["large tablet landscape 1366×1024", 1366, 1024, "wide"],
  ["tablet portrait 768×1024", 768, 1024, "side"],
  ["large tablet portrait 1024×1366", 1024, 1366, "side"],
  ["iPad Air portrait 820×1180", 820, 1180, "side"],
  ["small tablet portrait 600×960", 600, 960, "stack"],
  ["phone portrait 375×812", 375, 812, "stack"],
  ["small phone portrait 320×568", 320, 568, "stack"],
  ["big phone portrait 430×932", 430, 932, "stack"],
  ["phone landscape 812×375", 812, 375, "wide"],
  ["phone landscape 667×375", 667, 375, "wide"],
  ["phone landscape 932×430", 932, 430, "wide"],
];

describe("computeLayout", () => {
  it.each(cases)("%s → %s", (_name, width, height, expected) => {
    expect(computeLayout(width, height)).toBe(expected);
  });

  it("matches the shape of the game", () => {
    const { width, height } = gameConfig.runner.view;
    expect(LAYOUT_RULES.gameAspect).toBeCloseTo(width / height);
  });

  it("never leaves the tags overlapping the game in wide mode", () => {
    for (let w = 320; w <= 1920; w += 40) {
      for (let h = 320; h <= 1400; h += 40) {
        if (computeLayout(w, h) !== "wide") continue;
        const side = (w - gameColumnWidth(w, h)) / 2;
        expect(side).toBeGreaterThanOrEqual(LAYOUT_RULES.minSidePx);
      }
    }
  });

  it("only offers a side column to screens that can spare one", () => {
    for (let w = 320; w <= 1920; w += 40) {
      for (let h = 320; h <= 1400; h += 40) {
        if (computeLayout(w, h) !== "side") continue;
        expect(w).toBeGreaterThanOrEqual(LAYOUT_RULES.sideColumnMinWidthPx);
        // The game keeps a usable width once the column is taken.
        expect(w - LAYOUT_RULES.sideColumnPx).toBeGreaterThanOrEqual(400);
      }
    }
  });

  it("always picks one of the three layouts", () => {
    for (const [, w, h] of cases) expect(["wide", "side", "stack"]).toContain(computeLayout(w, h));
  });
});

describe("gameColumnWidth", () => {
  it("fills the height on a wide screen and the width on a tall one", () => {
    expect(gameColumnWidth(1280, 720)).toBeCloseTo(720 * 0.6);
    expect(gameColumnWidth(375, 812)).toBe(375);
  });
});
