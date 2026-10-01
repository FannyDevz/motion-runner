import { describe, expect, it } from "vitest";
import { gameConfig } from "../config/gameConfig";
import { PresenceMonitor } from "./PresenceMonitor";

const cfg = gameConfig.input.presence;

/** Feed `tracking` every 33 ms for `ms`, returning the first change reported. */
function feed(m: PresenceMonitor, start: number, ms: number, tracking: boolean) {
  for (let t = start; t < start + ms; t += 33) {
    const change = m.update(t, tracking);
    if (change) return { change, at: t - start };
  }
  return null;
}

describe("PresenceMonitor", () => {
  it("starts present and stays quiet while tracking", () => {
    const m = new PresenceMonitor(cfg);
    expect(m.present).toBe(true);
    expect(feed(m, 0, 10000, true)).toBeNull();
  });

  it("reports lost after the player is missing long enough", () => {
    const m = new PresenceMonitor(cfg);
    const r = feed(m, 0, cfg.lostAfterMs * 2, false);
    expect(r?.change).toBe("lost");
    expect(r?.at).toBeGreaterThanOrEqual(cfg.lostAfterMs);
    expect(r?.at).toBeLessThan(cfg.lostAfterMs + 100);
    expect(m.present).toBe(false);
  });

  it("ignores a brief dropout", () => {
    const m = new PresenceMonitor(cfg);
    expect(feed(m, 0, cfg.lostAfterMs - 200, false)).toBeNull();
    expect(feed(m, 5000, 2000, true)).toBeNull();
    expect(m.present).toBe(true);
  });

  it("restarts the lost timer when the player reappears briefly", () => {
    const m = new PresenceMonitor(cfg);
    feed(m, 0, cfg.lostAfterMs - 100, false);
    m.update(cfg.lostAfterMs, true);
    expect(feed(m, cfg.lostAfterMs + 50, cfg.lostAfterMs - 100, false)).toBeNull();
  });

  it("reports found only after the player has been back for a while", () => {
    const m = new PresenceMonitor(cfg);
    feed(m, 0, cfg.lostAfterMs * 2, false);
    const r = feed(m, 10000, cfg.foundAfterMs * 3, true);
    expect(r?.change).toBe("found");
    expect(r?.at).toBeGreaterThanOrEqual(cfg.foundAfterMs);
    expect(m.present).toBe(true);
  });

  it("does not report found for a flicker of tracking", () => {
    const m = new PresenceMonitor(cfg);
    feed(m, 0, cfg.lostAfterMs * 2, false);
    expect(feed(m, 10000, cfg.foundAfterMs - 200, true)).toBeNull();
    expect(feed(m, 12000, 2000, false)).toBeNull();
    expect(m.present).toBe(false);
  });

  it("reports each change only once", () => {
    const m = new PresenceMonitor(cfg);
    const changes: string[] = [];
    for (let t = 0; t < 20000; t += 33) {
      const tracking = t < 3000 || t > 9000;
      const c = m.update(t, tracking);
      if (c) changes.push(c);
    }
    expect(changes).toEqual(["lost", "found"]);
  });

  it("resets to present", () => {
    const m = new PresenceMonitor(cfg);
    feed(m, 0, cfg.lostAfterMs * 2, false);
    m.reset();
    expect(m.present).toBe(true);
  });
});
