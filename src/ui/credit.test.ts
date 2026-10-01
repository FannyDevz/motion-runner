import { describe, expect, it } from "vitest";
import html from "../../index.html?raw";
import { CREDIT } from "./credit";

describe("credit", () => {
  it("names the maker exactly", () => {
    expect(CREDIT.name).toBe("Tryas Sukmaning Sakti");
  });

  it("appears in the page metadata and on the main menu", () => {
    expect(html).toContain(`<meta name="author" content="${CREDIT.name}" />`);
    expect(html).toMatch(new RegExp(`class="credit">[^<]*<strong>${CREDIT.name}</strong>`));
  });
});
