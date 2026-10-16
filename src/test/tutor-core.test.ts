import { describe, expect, it } from "vitest";

import { RateLimiter } from "@/lib/rate-limit";
import { type Generate, runTutor } from "@/lib/tutor-core";
import { extractJson, normalize } from "@/lib/tutor-schemas";
import { promptFor } from "@/lib/tutor-prompts";

/** Test double: answers each call with the next queued reply and records the prompts. */
function scripted(...replies: (string | object)[]) {
  const calls: string[] = [];
  const queue = [...replies];
  const gen: Generate = async ({ prompt }) => {
    calls.push(prompt);
    const next = queue.shift();
    if (next === undefined) throw new Error("no reply queued");
    return typeof next === "string" ? next : JSON.stringify(next);
  };
  return { gen, calls };
}

const question = (correctIndex: number) => ({
  concept: "Comparing fractions",
  question: "Which is larger, 1/3 or 1/8?",
  options: [
    { text: "1/8", misconception: "bigger denominator means bigger" },
    { text: "1/3", misconception: null },
    { text: "They are equal", misconception: "ignores denominators" },
    { text: "Cannot tell", misconception: null },
  ],
  correctIndex,
  why: "Checks how denominators affect size.",
});

describe("question answer keys", () => {
  it("serves a question only when an independent solve agrees with the key", async () => {
    const { gen, calls } = scripted(question(1), { choice: 1 });
    const out = JSON.parse(await runTutor(gen, "start", { stuckOn: "fractions" }));
    expect(out.correctIndex).toBe(1);
    expect(calls).toHaveLength(2);
  });

  it("regenerates once when the solve disagrees, then serves the verified draft", async () => {
    const { gen, calls } = scripted(question(0), { choice: 1 }, question(1), { choice: 1 });
    const out = JSON.parse(await runTutor(gen, "start", { stuckOn: "fractions" }));
    expect(out.correctIndex).toBe(1);
    expect(calls[2]).toContain("incorrect answer key");
  });

  it("refuses to serve a question it cannot verify", async () => {
    const { gen } = scripted(question(0), { choice: 1 }, question(0), { choice: 1 });
    await expect(runTutor(gen, "start", {})).rejects.toThrow(/verify/);
  });

  it("treats an unreadable solve reply as unverified", async () => {
    const { gen } = scripted(question(1), "not json", question(1), "still not json");
    await expect(runTutor(gen, "start", {})).rejects.toThrow(/verify/);
  });
});

describe("output validation", () => {
  it("retries once on malformed JSON and tells the model what was wrong", async () => {
    const coach = { greeting: "Welcome back.", focus: "Review fractions.", tip: "Draw it." };
    const { gen, calls } = scripted("sorry, here you go", coach);
    expect(JSON.parse(await runTutor(gen, "coach", {}))).toEqual(coach);
    expect(calls[1]).toContain("did not match the required JSON shape");
  });

  it("gives up after a second invalid reply", async () => {
    const { gen } = scripted({ nope: 1 }, { nope: 2 });
    await expect(runTutor(gen, "coach", {})).rejects.toThrow(/usable answer/);
  });

  it("rejects duplicate options", async () => {
    const dup = question(1);
    dup.options[0]!.text = "1/3";
    const { gen } = scripted(dup, dup);
    await expect(runTutor(gen, "start", {})).rejects.toThrow(/usable answer/);
  });

  it("accepts JSON wrapped in code fences", () => {
    expect(JSON.parse(extractJson('```json\n{"a":1}\n```'))).toEqual({ a: 1 });
  });
});

describe("rules the model cannot be trusted with", () => {
  const diag = {
    demonstrated: [],
    hypotheses: [{ label: "x", summary: "You may be mixing it up.", confidence: "low" }],
    unresolved: ["Whether a prerequisite is missing."],
    needsFollowUp: true,
    followUp: { question: "Which?", options: ["a", "b"], why: "to separate them" },
    recommendedStyle: "visual",
  };

  it("stops asking follow-ups after two", () => {
    expect((normalize("diagnose", diag, { followUpCount: 2 }) as { needsFollowUp: boolean }).needsFollowUp).toBe(false);
    expect((normalize("diagnose", diag, { followUpCount: 1 }) as { needsFollowUp: boolean }).needsFollowUp).toBe(true);
  });

  it("keeps a single observed answer at low confidence", () => {
    const out = normalize("diagnose", {
      ...diag,
      hypotheses: [{ ...diag.hypotheses[0]!, confidence: "high" }],
    }, { learnerAnswer: "A", diagnosticCorrect: false }) as typeof diag;
    expect(out.hypotheses[0]?.confidence).toBe("low");
    expect(out.needsFollowUp).toBe(true);
  });

  it("caps confidence at medium until three answers are observed", () => {
    const out = normalize("diagnose", {
      ...diag,
      hypotheses: [{ ...diag.hypotheses[0]!, confidence: "high" }],
    }, {
      learnerAnswer: "A",
      diagnosticCorrect: false,
      followUpAnswers: [{ q: "Why?", a: "B" }],
      followUpCount: 1,
    }) as typeof diag;
    expect(out.hypotheses[0]?.confidence).toBe("medium");
  });

  it("allows higher confidence only after three observed answers", () => {
    const out = normalize("diagnose", {
      ...diag,
      hypotheses: [{ ...diag.hypotheses[0]!, confidence: "high" }],
    }, {
      learnerAnswer: "A",
      diagnosticCorrect: false,
      followUpAnswers: [{ q: "Why?", a: "B" }, { q: "Another check?", a: "C" }],
      followUpCount: 2,
    }) as typeof diag;
    expect(out.hypotheses[0]?.confidence).toBe("high");
    expect(out.needsFollowUp).toBe(false);
  });

  it("lowers confidence when the learner disputes a hypothesis even after more evidence", () => {
    const out = normalize("diagnose", {
      ...diag,
      hypotheses: [{ ...diag.hypotheses[0]!, confidence: "high" }],
    }, {
      learnerAnswer: "A",
      followUpAnswers: [{ q: "Why?", a: "B" }, { q: "Another check?", a: "C" }],
      followUpCount: 2,
      disputedHypotheses: ["x"],
    }) as typeof diag;
    expect(out.hypotheses[0]?.confidence).toBe("low");
  });

  it("instructs the diagnosis to keep self-report distinct from evidence and surface contradictions", () => {
    const prompt = promptFor("diagnose", { learnerPreferences: { selfReportedLevel: "confident" } });
    expect(prompt).toContain("self-report distinct from demonstrated evidence");
    expect(prompt).toContain("contradictory");
    expect(prompt).toContain("disputed");
  });

  it("only lets a course prerequisite point at an earlier topic", () => {
    const assessment = (id: string) => ({
      title: "a",
      purpose: "p",
      objectiveQuestions: [{ id: `${id}-objective`, objective: "o", question: "q", options: ["a", "b", "c", "d"], correctIndex: 1, explanation: "e", hint: "h", points: 1 }],
      openQuestions: [{ id: `${id}-open`, objective: "o", prompt: "p", referenceCriteria: "r", rubric: [{ criterion: "c", points: 1 }], hint: "h" }],
      passCriteria: "p",
    });
    const course = {
      title: "t", goal: "g", outcomes: ["o"],
      phases: [
        { id: "phase-1", title: "First", purpose: "p", topics: [
          { id: "a", name: "A", why: "w", covers: ["A"], prerequisites: ["b"], objectives: ["o"], subtopics: [{ name: "s", objective: "o" }], lesson: { explanation: "e", examples: [{ prompt: "p", walkthrough: "w" }], guidedPractice: [{ prompt: "p", hint: "h", successCriteria: "s" }] }, minutes: 5 },
          { id: "b", name: "B", why: "w", covers: ["B"], prerequisites: ["a", "Outside"], objectives: ["o"], subtopics: [{ name: "s", objective: "o" }], lesson: { explanation: "e", examples: [{ prompt: "p", walkthrough: "w" }], guidedPractice: [{ prompt: "p", hint: "h", successCriteria: "s" }] }, minutes: 5 },
        ], assessment: assessment("first") },
        { id: "phase-2", title: "Second", purpose: "p", topics: [
          { id: "c", name: "C", why: "w", covers: ["C"], prerequisites: ["a", "b"], objectives: ["o"], subtopics: [{ name: "s", objective: "o" }], lesson: { explanation: "e", examples: [{ prompt: "p", walkthrough: "w" }], guidedPractice: [{ prompt: "p", hint: "h", successCriteria: "s" }] }, minutes: 5 },
          { id: "d", name: "D", why: "w", covers: ["D"], prerequisites: ["c"], objectives: ["o"], subtopics: [{ name: "s", objective: "o" }], lesson: { explanation: "e", examples: [{ prompt: "p", walkthrough: "w" }], guidedPractice: [{ prompt: "p", hint: "h", successCriteria: "s" }] }, minutes: 5 },
        ], assessment: assessment("second") },
      ],
    };
    const out = normalize("course", course, {}) as { topics: { id: string; prerequisites: string[] }[] };
    expect(out.topics.map((t) => t.prerequisites)).toEqual([[], ["a"], ["a", "b"], ["c"]]);
  });
});

describe("RateLimiter", () => {
  it("blocks after the limit and recovers when the window passes", () => {
    let t = 0;
    const r = new RateLimiter(2, 1000, () => t);
    expect([r.take("a"), r.take("a"), r.take("a")]).toEqual([true, true, false]);
    expect(r.take("b")).toBe(true);
    t = 1001;
    expect(r.take("a")).toBe(true);
  });
});
