import { describe, expect, it } from "vitest";
import { gameConfig } from "../config/gameConfig";
import { applyQuestionOverrides } from "./QuestionOverrides";

const base = gameConfig.runner.questions;

describe("applyQuestionOverrides", () => {
  it("returns the config unchanged without parameters", () => {
    expect(applyQuestionOverrides(base, "")).toBe(base);
  });

  it("parses categories, trimming and lowercasing", () => {
    expect(applyQuestionOverrides(base, "?categories=Math, science ,").categories).toEqual(["math", "science"]);
  });

  it("ignores an empty categories value", () => {
    expect(applyQuestionOverrides(base, "?categories=").categories).toBe(base.categories);
  });

  it("sets a fixed difficulty", () => {
    const q = applyQuestionOverrides(base, "?difficulty=hard");
    expect(q.difficulty).toMatchObject({ mode: "fixed", fixed: "HARD" });
  });

  it("can switch back to progressive difficulty", () => {
    const fixed = { ...base, difficulty: { ...base.difficulty, mode: "fixed" as const } };
    expect(applyQuestionOverrides(fixed, "?difficulty=Progressive").difficulty.mode).toBe("progressive");
  });

  it("ignores unknown difficulty values", () => {
    expect(applyQuestionOverrides(base, "?difficulty=impossible")).toBe(base);
  });

  it("combines both overrides without touching other settings", () => {
    const q = applyQuestionOverrides(base, "?categories=logic&difficulty=easy");
    expect(q.categories).toEqual(["logic"]);
    expect(q.difficulty.fixed).toBe("EASY");
    expect(q.scoring).toBe(base.scoring);
  });
});
