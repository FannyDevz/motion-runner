import { describe, expect, it } from "vitest";
import { Pager } from "./Pager";

describe("Pager", () => {
  it("starts on the first page", () => {
    const p = new Pager(5);
    expect(p).toMatchObject({ index: 0, isFirst: true, isLast: false, label: "1 / 5" });
  });

  it("moves forward and back", () => {
    const p = new Pager(3);
    expect(p.next()).toBe(true);
    expect(p.index).toBe(1);
    expect(p.next()).toBe(true);
    expect(p).toMatchObject({ index: 2, isLast: true, label: "3 / 3" });
    expect(p.previous()).toBe(true);
    expect(p.index).toBe(1);
  });

  it("stays put at either end", () => {
    const p = new Pager(2);
    expect(p.previous()).toBe(false);
    expect(p.index).toBe(0);
    p.next();
    expect(p.next()).toBe(false);
    expect(p.index).toBe(1);
  });

  it("jumps to a page, clamped to the valid range", () => {
    const p = new Pager(4);
    p.goTo(2);
    expect(p.index).toBe(2);
    p.goTo(99);
    expect(p.index).toBe(3);
    p.goTo(-5);
    expect(p.index).toBe(0);
    p.goTo(1.9);
    expect(p.index).toBe(1);
  });

  it("resets", () => {
    const p = new Pager(3);
    p.goTo(2);
    p.reset();
    expect(p.isFirst).toBe(true);
  });

  it("works with a single page", () => {
    const p = new Pager(1);
    expect(p).toMatchObject({ isFirst: true, isLast: true });
    expect(p.next()).toBe(false);
    expect(p.previous()).toBe(false);
  });

  it("refuses zero or fractional page counts", () => {
    expect(() => new Pager(0)).toThrow();
    expect(() => new Pager(2.5)).toThrow();
    expect(() => new Pager(-1)).toThrow();
  });
});
