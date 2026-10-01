import { describe, expect, it } from "vitest";
import { formatSeconds } from "./format";

describe("formatSeconds", () => {
  it("uses a decimal comma", () => {
    expect(formatSeconds(1.8)).toBe("1,8 detik");
    expect(formatSeconds(0.5)).toBe("0,5 detik");
  });

  it("drops a pointless ,0", () => {
    expect(formatSeconds(5)).toBe("5 detik");
    expect(formatSeconds(2.0)).toBe("2 detik");
  });

  it("rounds floating-point noise to one decimal", () => {
    expect(formatSeconds(0.1 + 0.2)).toBe("0,3 detik");
    expect(formatSeconds(1.7999999)).toBe("1,8 detik");
    expect(formatSeconds(4.96)).toBe("5 detik");
  });
});
