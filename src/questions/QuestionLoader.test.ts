import { describe, expect, it } from "vitest";
import { gameConfig } from "../config/gameConfig";
import { categoryFromFileName, isSafeFileName, loadQuestionBank, type FetchLike } from "./QuestionLoader";
import { loadShippedQuestions, shippedFileNames } from "./testing/shippedQuestions";

const mapping = { laneOrder: gameConfig.runner.questions.laneOrder };
const BASE = "/questions/";

const q = (id: string, extra: object = {}) => ({
  id,
  text: `Soal ${id}?`,
  type: "LANE",
  difficulty: "EASY",
  answers: [{ text: "a" }, { text: "b", correct: true }, { text: "c" }],
  ...extra,
});

type Entry = unknown | { __status: number } | { __throw: string } | { __badJson: true };

/** A fetch backed by an object of url → data (or a failure). */
function serve(files: Record<string, Entry>): FetchLike {
  return async (url) => {
    const entry = files[url];
    if (entry === undefined) return { ok: false, status: 404, json: async () => null };
    if (typeof entry === "object" && entry !== null) {
      const e = entry as Record<string, unknown>;
      if ("__throw" in e) throw new Error(String(e.__throw));
      if ("__status" in e) return { ok: false, status: Number(e.__status), json: async () => null };
      if ("__badJson" in e) return { ok: true, status: 200, json: async () => Promise.reject(new SyntaxError("Unexpected token")) };
    }
    return { ok: true, status: 200, json: async () => entry };
  };
}

const manifest = (...files: unknown[]) => ({ files });

describe("file name helpers", () => {
  it("derives the category from the file name", () => {
    expect(categoryFromFileName("math.json")).toBe("math");
    expect(categoryFromFileName("Bahasa-Indonesia.JSON")).toBe("bahasa-indonesia");
  });

  it("accepts only plain json file names", () => {
    for (const ok of ["math.json", "ipa_2.json", "a-b.json"]) expect(isSafeFileName(ok)).toBe(true);
    for (const bad of ["", "../secret.json", "a/b.json", "a\\b.json", "math.txt", ".hidden.json", "math.json.exe", "http://x/y.json", "-x.json"]) {
      expect(isSafeFileName(bad)).toBe(false);
    }
  });
});

describe("loadQuestionBank", () => {
  it("loads every listed file in order", async () => {
    const r = await loadQuestionBank(BASE, mapping, serve({
      [`${BASE}index.json`]: manifest("math.json", "science.json"),
      [`${BASE}math.json`]: [q("m1"), q("m2")],
      [`${BASE}science.json`]: [q("s1")],
    }));
    expect(r.problems).toEqual([]);
    expect(r.bank?.questions.map((x) => x.id)).toEqual(["m1", "m2", "s1"]);
    expect(r.reports).toEqual([
      { file: "math.json", loaded: 2 },
      { file: "science.json", loaded: 1 },
    ]);
  });

  it("takes the category from the file name unless the question names its own", async () => {
    const r = await loadQuestionBank(BASE, mapping, serve({
      [`${BASE}index.json`]: manifest("math.json"),
      [`${BASE}math.json`]: [q("a"), q("b", { category: "logic" })],
    }));
    expect(r.bank?.get("a")?.category).toBe("math");
    expect(r.bank?.get("b")?.category).toBe("logic");
  });

  it("skips an invalid file but still loads the others", async () => {
    const r = await loadQuestionBank(BASE, mapping, serve({
      [`${BASE}index.json`]: manifest("good.json", "bad.json"),
      [`${BASE}good.json`]: [q("g1")],
      [`${BASE}bad.json`]: [q("b1", { answers: [{ text: "x" }, { text: "y" }] })], // no correct answer
    }));
    expect(r.bank?.questions.map((x) => x.id)).toEqual(["g1"]);
    expect(r.reports.find((x) => x.file === "bad.json")).toMatchObject({ loaded: 0 });
    expect(r.problems.join("\n")).toMatch(/bad\.json: .*exactly one correct answer/);
  });

  it("reports every problem in a bad file, each with the file name", async () => {
    const r = await loadQuestionBank(BASE, mapping, serve({
      [`${BASE}index.json`]: manifest("bad.json"),
      [`${BASE}bad.json`]: [q("a", { difficulty: "EXTREME" }), q("b", { text: "" })],
    }));
    const lines = r.problems.filter((p) => p.startsWith("bad.json:"));
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it("copes with a missing file, a failed request and broken JSON", async () => {
    const r = await loadQuestionBank(BASE, mapping, serve({
      [`${BASE}index.json`]: manifest("ok.json", "missing.json", "down.json", "broken.json", "gone.json"),
      [`${BASE}ok.json`]: [q("o1")],
      [`${BASE}down.json`]: { __throw: "Failed to fetch" },
      [`${BASE}broken.json`]: { __badJson: true },
      [`${BASE}gone.json`]: { __status: 500 },
    }));
    expect(r.bank?.questions.map((x) => x.id)).toEqual(["o1"]);
    const text = r.problems.join("\n");
    expect(text).toMatch(/missing\.json: tidak bisa dimuat \(HTTP 404\)/);
    expect(text).toMatch(/down\.json: tidak bisa dimuat \(Failed to fetch\)/);
    expect(text).toMatch(/broken\.json: tidak bisa dimuat/);
    expect(text).toMatch(/gone\.json: tidak bisa dimuat \(HTTP 500\)/);
  });

  it("rejects a file whose content is not an array of questions", async () => {
    const r = await loadQuestionBank(BASE, mapping, serve({
      [`${BASE}index.json`]: manifest("obj.json", "ok.json"),
      [`${BASE}obj.json`]: { not: "an array" },
      [`${BASE}ok.json`]: [q("o1")],
    }));
    expect(r.bank?.size).toBe(1);
    expect(r.problems.join("\n")).toMatch(/obj\.json: .*must be an array/);
  });

  it("ignores unsafe or odd names in the list, and says so", async () => {
    const r = await loadQuestionBank(BASE, mapping, serve({
      [`${BASE}index.json`]: manifest("../secret.json", "a/b.json", "notes.txt", 42, "ok.json"),
      [`${BASE}ok.json`]: [q("o1")],
      [`${BASE}../secret.json`]: [q("hacked")],
    }));
    expect(r.bank?.questions.map((x) => x.id)).toEqual(["o1"]);
    expect(r.problems.filter((p) => p.startsWith("index.json:"))).toHaveLength(4);
  });

  it("loads a file listed twice only once", async () => {
    const r = await loadQuestionBank(BASE, mapping, serve({
      [`${BASE}index.json`]: manifest("ok.json", "ok.json"),
      [`${BASE}ok.json`]: [q("o1")],
    }));
    expect(r.problems).toEqual([]);
    expect(r.bank?.size).toBe(1);
  });

  it("drops a question id that appears in two files and says where it was first seen", async () => {
    const r = await loadQuestionBank(BASE, mapping, serve({
      [`${BASE}index.json`]: manifest("a.json", "b.json"),
      [`${BASE}a.json`]: [q("same"), q("a-only")],
      [`${BASE}b.json`]: [q("same", { text: "Other" }), q("b-only")],
    }));
    expect(r.bank?.questions.map((x) => x.id)).toEqual(["same", "a-only", "b-only"]);
    expect(r.bank?.get("same")?.text).toBe("Soal same?"); // the first one wins
    expect(r.problems.join("\n")).toMatch(/"same" di b\.json sudah ada di a\.json/);
    expect(r.reports.find((x) => x.file === "b.json")?.loaded).toBe(1);
  });

  it("has no bank, and says why, when index.json is missing or malformed", async () => {
    const missing = await loadQuestionBank(BASE, mapping, serve({}));
    expect(missing.bank).toBeNull();
    expect(missing.problems[0]).toMatch(/index\.json.*tidak bisa dimuat/);

    const wrong = await loadQuestionBank(BASE, mapping, serve({ [`${BASE}index.json`]: ["math.json"] }));
    expect(wrong.bank).toBeNull();
    expect(wrong.problems[0]).toMatch(/"files"/);

    const offline = await loadQuestionBank(BASE, mapping, serve({ [`${BASE}index.json`]: { __throw: "Failed to fetch" } }));
    expect(offline.bank).toBeNull();
    expect(offline.problems[0]).toMatch(/Failed to fetch/);
  });

  it("has no bank when nothing loads", async () => {
    const r = await loadQuestionBank(BASE, mapping, serve({
      [`${BASE}index.json`]: manifest("a.json"),
      [`${BASE}a.json`]: [],
    }));
    expect(r.bank).toBeNull();
    expect(r.problems.join("\n")).toMatch(/Tidak ada soal/);
  });

  it("requests files relative to the base URL", async () => {
    const asked: string[] = [];
    const base: FetchLike = serve({ "/app/questions/index.json": manifest("x.json"), "/app/questions/x.json": [q("x1")] });
    await loadQuestionBank("/app/questions/", mapping, async (url) => (asked.push(url), base(url)));
    expect(asked.sort()).toEqual(["/app/questions/index.json", "/app/questions/x.json"]);
  });
});

describe("the question files the game ships with", async () => {
  const result = await loadShippedQuestions(mapping);

  it("load without any problem", () => {
    expect(result.problems).toEqual([]);
    expect(result.bank).not.toBeNull();
  });

  it("are all listed in index.json, and every listed file exists", () => {
    expect(result.reports.map((r) => r.file).sort()).toEqual(shippedFileNames);
    for (const report of result.reports) expect(report.loaded).toBeGreaterThan(0);
  });

  it("put each question in the category of its file", () => {
    for (const report of result.reports) {
      const category = categoryFromFileName(report.file);
      const inFile = result.bank?.questions.filter((x) => x.category === category).length;
      expect(inFile).toBe(report.loaded);
    }
  });

  it("have a label for every category", () => {
    const labels = Object.keys(gameConfig.runner.questions.categoryLabels);
    expect(new Set(result.bank?.categories)).toEqual(new Set(labels));
  });
});
