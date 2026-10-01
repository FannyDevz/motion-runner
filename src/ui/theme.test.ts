import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, HIGH_CONTRAST_THEME, answerColors, cssColor, parseColor, readTheme, type Theme } from "./theme";

describe("parseColor", () => {
  it("parses long and short hex, in any case, with spaces", () => {
    expect(parseColor("#ff8000")).toBe(0xff8000);
    expect(parseColor("  #FF8000 ")).toBe(0xff8000);
    expect(parseColor("#f80")).toBe(0xff8800);
    expect(parseColor("#000")).toBe(0);
  });

  it("rejects anything else", () => {
    for (const bad of ["", "red", "ff8000", "#ff80", "#gg0000", "rgb(1,2,3)", "#ff8000ff"]) expect(parseColor(bad)).toBeNull();
  });
});

describe("cssColor", () => {
  it("formats with leading zeros", () => {
    expect(cssColor(0xff8000)).toBe("#ff8000");
    expect(cssColor(0x0000ff)).toBe("#0000ff");
    expect(cssColor(0)).toBe("#000000");
  });

  it("round-trips with parseColor", () => {
    for (const c of Object.values(DEFAULT_THEME)) expect(parseColor(cssColor(c))).toBe(c);
  });
});

describe("readTheme", () => {
  it("falls back to the defaults when nothing is defined", () => {
    expect(readTheme(() => "")).toEqual(DEFAULT_THEME);
  });

  it("takes values from the CSS properties", () => {
    const theme = readTheme((p) => (p === "--c-track" ? " #112233" : p === "--c-chalk-pink" ? "#fff" : ""));
    expect(theme.track).toBe(0x112233);
    expect(theme.chalkPink).toBe(0xffffff);
    expect(theme.grass).toBe(DEFAULT_THEME.grass);
  });

  it("ignores malformed values", () => {
    expect(readTheme(() => "not a colour")).toEqual(DEFAULT_THEME);
  });

  it("asks for a distinct property per colour", () => {
    const asked: string[] = [];
    readTheme((p) => (asked.push(p), ""));
    expect(new Set(asked).size).toBe(Object.keys(DEFAULT_THEME).length);
    expect(asked.every((p) => p.startsWith("--c-"))).toBe(true);
  });
});

describe("themes", () => {
  it("define every colour in both themes", () => {
    const keys = Object.keys(DEFAULT_THEME).sort();
    expect(Object.keys(HIGH_CONTRAST_THEME).sort()).toEqual(keys);
  });

  it("gives four distinct answer colours", () => {
    for (const theme of [DEFAULT_THEME, HIGH_CONTRAST_THEME] as Theme[]) {
      expect(new Set(answerColors(theme)).size).toBe(4);
    }
  });

  it("keeps the high-contrast track and sky black and the lines white", () => {
    expect(HIGH_CONTRAST_THEME.track).toBe(0);
    expect(HIGH_CONTRAST_THEME.skyTop).toBe(0);
    expect(HIGH_CONTRAST_THEME.trackLine).toBe(0xffffff);
  });
});
