import { describe, expect, it } from "vitest";
import { loadShippedQuestions } from "./testing/shippedQuestions";
import { answerLetter, applyAnswerMapping, presentQuestion } from "./AnswerMapping";
import { evaluateAnswer } from "./AnswerValidation";
import type { Question, RawQuestion } from "./Question";
import { QuestionBank, QuestionDataError } from "./QuestionBank";
import { QuestionSession } from "./QuestionSession";

const mapping = { laneOrder: ["LEFT", "CENTER", "RIGHT"] } as const;

const laneRaw: RawQuestion = {
  id: "q1",
  text: "Which animal is a mammal?",
  type: "LANE",
  answers: [{ text: "Chicken" }, { text: "Cat", correct: true }, { text: "Fish" }],
};

const moveRaw: RawQuestion = {
  id: "q2",
  text: "Overhead obstacle?",
  type: "MOVEMENT",
  answers: [
    { text: "Jump", action: "JUMP" },
    { text: "Crouch", action: "CROUCH", correct: true },
  ],
};

function mapped(raw: RawQuestion): Question {
  return applyAnswerMapping(raw, mapping);
}

describe("answer mapping", () => {
  it("maps LANE answers A/B/C to lanes by position", () => {
    const q = mapped(laneRaw);
    expect(q.answers.map((a) => [a.id, a.action])).toEqual([
      ["A", "LEFT"],
      ["B", "CENTER"],
      ["C", "RIGHT"],
    ]);
  });

  it("is configurable rather than hard-coded", () => {
    const q = applyAnswerMapping(laneRaw, { laneOrder: ["RIGHT", "LEFT", "CENTER"] });
    expect(q.answers.map((a) => a.action)).toEqual(["RIGHT", "LEFT", "CENTER"]);
  });

  it("lets an explicit action in the data win over the mapping", () => {
    const raw: RawQuestion = { ...laneRaw, answers: [{ text: "x", action: "RIGHT" }, { text: "y", correct: true }] };
    expect(applyAnswerMapping(raw, mapping).answers.map((a) => a.action)).toEqual(["RIGHT", "CENTER"]);
  });

  it("keeps explicit movement actions and marks the correct answer", () => {
    const q = mapped(moveRaw);
    expect(q.answers.map((a) => a.action)).toEqual(["JUMP", "CROUCH"]);
    expect(q.answers.map((a) => a.correct)).toEqual([false, true]);
  });

  it("throws when an answer's action cannot be derived", () => {
    const raw: RawQuestion = { ...moveRaw, answers: [{ text: "a" }, { text: "b", correct: true }] };
    expect(() => applyAnswerMapping(raw, mapping)).toThrow(/no action/);
  });

  it("labels positions as letters", () => {
    expect([0, 1, 2].map(answerLetter)).toEqual(["A", "B", "C"]);
  });
});

describe("evaluateAnswer", () => {
  const lane = mapped(laneRaw); // correct = B = CENTER

  it("separates selected answer, required movement, actual movement and correctness", () => {
    expect(evaluateAnswer(lane, "CENTER")).toEqual({
      questionId: "q1",
      selectedAnswerId: "B",
      requiredMovement: "CENTER",
      actualMovement: "CENTER",
      correct: true,
    });
    expect(evaluateAnswer(lane, "LEFT")).toMatchObject({ selectedAnswerId: "A", requiredMovement: "CENTER", correct: false });
  });

  it("does not treat a movement as correct merely because the player moved", () => {
    expect(evaluateAnswer(lane, "RIGHT").correct).toBe(false);
  });

  it("selects nothing when there was no response or the movement matches no answer", () => {
    expect(evaluateAnswer(lane, null)).toMatchObject({ selectedAnswerId: null, actualMovement: null, correct: false });
    expect(evaluateAnswer(mapped(moveRaw), "LEFT")).toMatchObject({ selectedAnswerId: null, correct: false });
  });

  it("validates movement questions", () => {
    const q = mapped(moveRaw);
    expect(evaluateAnswer(q, "CROUCH").correct).toBe(true);
    expect(evaluateAnswer(q, "JUMP").correct).toBe(false);
  });

  it("throws if the question has no correct answer", () => {
    const q = mapped({ ...laneRaw, answers: [{ text: "a" }, { text: "b" }] });
    expect(() => evaluateAnswer(q, "LEFT")).toThrow(/no correct answer/);
  });
});

describe("QuestionSession", () => {
  it("LANE: uses the lane the player is in when it resolves", () => {
    const s = new QuestionSession(mapped(laneRaw));
    expect(s.currentSelection("LEFT")).toBe("A");
    expect(s.currentSelection("CENTER")).toBe("B");
    expect(s.resolve("CENTER").correct).toBe(true);
    expect(s.resolve("RIGHT").correct).toBe(false);
  });

  it("LANE: ignores recorded movements", () => {
    const s = new QuestionSession(mapped(laneRaw));
    s.recordMovement("JUMP");
    expect(s.resolve("CENTER").actualMovement).toBe("CENTER");
  });

  it("MOVEMENT: has no response until the player moves", () => {
    const s = new QuestionSession(mapped(moveRaw));
    expect(s.currentSelection("CENTER")).toBeNull();
    expect(s.resolve("CENTER")).toMatchObject({ actualMovement: null, correct: false });
  });

  it("MOVEMENT: the last answer movement wins, other movements are ignored", () => {
    const s = new QuestionSession(mapped(moveRaw));
    s.recordMovement("JUMP");
    s.recordMovement("LEFT");
    expect(s.currentSelection("CENTER")).toBe("A");
    s.recordMovement("CROUCH");
    expect(s.resolve("CENTER")).toMatchObject({ selectedAnswerId: "B", correct: true });
  });
});

describe("QuestionBank.fromData", () => {
  const catches = (data: unknown): string => {
    try {
      QuestionBank.fromData(data, mapping);
    } catch (e) {
      expect(e).toBeInstanceOf(QuestionDataError);
      return (e as Error).message;
    }
    return "";
  };

  it("accepts valid data", () => {
    const bank = QuestionBank.fromData([laneRaw, moveRaw], mapping);
    expect(bank.size).toBe(2);
    expect(bank.get("q1")?.answers).toHaveLength(3);
    expect(bank.get("nope")).toBeUndefined();
  });

  it("rejects non-array data", () => {
    expect(catches({})).toMatch(/must be an array/);
  });

  it("reports missing and duplicate ids, bad type and missing text", () => {
    const msg = catches([
      { ...laneRaw, id: "" },
      { ...laneRaw },
      { ...laneRaw },
      { ...laneRaw, id: "t", type: "WHATEVER" },
      { ...laneRaw, id: "u", text: " " },
    ]);
    expect(msg).toMatch(/non-empty string id/);
    expect(msg).toMatch(/Duplicate question id "q1"/);
    expect(msg).toMatch(/unknown type "WHATEVER"/);
    expect(msg).toMatch(/needs text/);
  });

  it("requires exactly one correct answer", () => {
    expect(catches([{ ...laneRaw, answers: [{ text: "a" }, { text: "b" }] }])).toMatch(/exactly one correct answer \(found 0\)/);
    expect(catches([{ ...laneRaw, answers: [{ text: "a", correct: true }, { text: "b", correct: true }] }])).toMatch(/found 2/);
  });

  it("requires at least two answers", () => {
    expect(catches([{ ...laneRaw, answers: [{ text: "a", correct: true }] }])).toMatch(/at least 2 answers/);
  });

  it("rejects two answers mapped to the same movement", () => {
    const raw = { ...laneRaw, answers: [{ text: "a", action: "LEFT", correct: true }, { text: "b", action: "LEFT" }] };
    expect(catches([raw])).toMatch(/same movement/);
  });

  it("rejects movement answers that do not fit the question type", () => {
    const lane = { ...laneRaw, answers: [{ text: "a", action: "JUMP", correct: true }, { text: "b" }] };
    expect(catches([lane])).toMatch(/LANE questions allow LEFT\/CENTER\/RIGHT/);
    const move = { ...moveRaw, answers: [{ text: "a", action: "LEFT", correct: true }, { text: "b", action: "CROUCH" }] };
    expect(catches([move])).toMatch(/MOVEMENT questions allow JUMP\/CROUCH/);
  });

  it("rejects unknown actions and MOVEMENT answers without an action", () => {
    expect(catches([{ ...moveRaw, answers: [{ text: "a", action: "DANCE" }, { text: "b", action: "JUMP" }] }])).toMatch(/unknown action "DANCE"/);
    expect(catches([{ ...moveRaw, answers: [{ text: "a" }, { text: "b", action: "JUMP" }] }])).toMatch(/needs an explicit action/);
  });

  it("rejects LANE questions with more answers than lanes", () => {
    const four = { ...laneRaw, answers: [{ text: "a", correct: true }, { text: "b" }, { text: "c" }, { text: "d" }] };
    expect(catches([four])).toMatch(/no lane: the answer mapping only covers 3 answers/);
  });

  it("lists every problem at once", () => {
    const err = (() => {
      try {
        QuestionBank.fromData([{ ...laneRaw, id: "a", answers: [{ text: "x" }, { text: "y" }] }, { ...laneRaw, id: "b", text: "" }], mapping);
      } catch (e) {
        return e as QuestionDataError;
      }
      throw new Error("expected failure");
    })();
    expect(err.problems.length).toBeGreaterThanOrEqual(2);
  });
});

describe("shipped question data", async () => {
  const { bank: loaded } = await loadShippedQuestions(mapping);
  const bank = loaded as QuestionBank;

  it("is valid and has both question types", () => {
    expect(bank.size).toBeGreaterThanOrEqual(8);
    expect(new Set(bank.questions.map((q) => q.type))).toEqual(new Set(["LANE", "MOVEMENT"]));
  });

  it("does not always put the correct LANE answer in the same lane", () => {
    const lanes = bank.questions
      .filter((q) => q.type === "LANE")
      .map((q) => q.answers.find((a) => a.correct)?.action);
    expect(new Set(lanes)).toEqual(new Set(["LEFT", "CENTER", "RIGHT"]));
  });

  it("does not always require the same movement for MOVEMENT questions", () => {
    const moves = bank.questions
      .filter((q) => q.type === "MOVEMENT")
      .map((q) => q.answers.find((a) => a.correct)?.action);
    expect(new Set(moves)).toEqual(new Set(["JUMP", "CROUCH"]));
  });
});

describe("category, difficulty and shuffle fields", () => {
  it("defaults to general / EASY and shuffles LANE answers", () => {
    const q = mapped(laneRaw);
    expect(q).toMatchObject({ category: "general", difficulty: "EASY", shuffleAnswers: true });
  });

  it("keeps the values given in the data", () => {
    const q = mapped({ ...laneRaw, category: "math", difficulty: "HARD", shuffleAnswers: false });
    expect(q).toMatchObject({ category: "math", difficulty: "HARD", shuffleAnswers: false });
  });

  it("never shuffles MOVEMENT questions or ones with explicit actions", () => {
    expect(mapped(moveRaw).shuffleAnswers).toBe(false);
    const explicit: RawQuestion = { ...laneRaw, answers: [{ text: "a", action: "LEFT" }, { text: "b", action: "RIGHT", correct: true }] };
    expect(mapped(explicit).shuffleAnswers).toBe(false);
  });

  it("rejects an unknown difficulty, a blank category and a non-boolean shuffle flag", () => {
    const check = (patch: object): string => {
      try {
        QuestionBank.fromData([{ ...laneRaw, ...patch }], mapping);
      } catch (e) {
        return (e as Error).message;
      }
      return "";
    };
    expect(check({ difficulty: "EXTREME" })).toMatch(/unknown difficulty "EXTREME"/);
    expect(check({ category: " " })).toMatch(/invalid category/);
    expect(check({ shuffleAnswers: "yes" })).toMatch(/shuffleAnswers must be true or false/);
  });

  it("lists categories and filters by them", () => {
    const bank = QuestionBank.fromData(
      [{ ...laneRaw, id: "a", category: "math" }, { ...laneRaw, id: "b", category: "science" }, { ...laneRaw, id: "c", category: "math" }],
      mapping,
    );
    expect(bank.categories).toEqual(["math", "science"]);
    expect(bank.filterByCategory(["math"]).map((q) => q.id)).toEqual(["a", "c"]);
    expect(bank.filterByCategory(null)).toHaveLength(3);
    expect(bank.filterByCategory(["art"])).toEqual([]);
  });
});

describe("presentQuestion", () => {
  const lane = mapped(laneRaw);

  it("returns the same question when shuffling is not allowed", () => {
    const fixed = { ...lane, shuffleAnswers: false };
    expect(presentQuestion(fixed, mapping, () => 0.3)).toBe(fixed);
  });

  it("reassigns letters and lanes by the new position", () => {
    const shown = presentQuestion(lane, mapping, () => 0); // always swaps with index 0
    expect(shown.answers.map((a) => a.id)).toEqual(["A", "B", "C"]);
    expect(shown.answers.map((a) => a.action)).toEqual(["LEFT", "CENTER", "RIGHT"]);
    expect(shown.answers.map((a) => a.text)).not.toEqual(lane.answers.map((a) => a.text));
  });

  it("keeps exactly one correct answer, with the right text", () => {
    const shown = presentQuestion(lane, mapping, () => 0.7);
    expect(shown.answers.filter((a) => a.correct).map((a) => a.text)).toEqual(["Cat"]);
  });

  it("evaluates correctly against the shuffled layout", () => {
    const shown = presentQuestion(lane, mapping, () => 0);
    const correct = shown.answers.find((a) => a.correct);
    expect(evaluateAnswer(shown, correct?.action ?? null).correct).toBe(true);
  });
});
