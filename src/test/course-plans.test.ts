import { describe, expect, it } from "vitest";

import { promptFor } from "@/lib/tutor-prompts";
import { type Generate, runTutor } from "@/lib/tutor-core";
import { openCourseAssessment } from "@/lib/answer-key.server";
import { protectCoursePlan } from "@/lib/course-assessment.server";
import { courseSchema, publicCourseSchema } from "@/lib/tutor-schemas";

import { coursePlan } from "./course-fixtures";

const signingSecret = "course-assessment-test-secret-long-enough";

describe("personalized course plans", () => {
  it("uses different diagnostic evidence to produce different validated journeys", async () => {
    const learnerA = {
      wantsToLearn: "Solve linear equations",
      diagnosticResults: [{ concept: "inverse operations", status: "Needs more practice", attempts: 2, cleanSuccesses: 0, misconceptions: ["changes only one side"] }],
      prerequisiteGaps: ["inverse operations"],
      alreadyDemonstrated: [],
    };
    const learnerB = {
      wantsToLearn: "Solve linear equations",
      diagnosticResults: [{ concept: "inverse operations", status: "Demonstrated under current criteria", attempts: 3, cleanSuccesses: 2, misconceptions: [] }],
      prerequisiteGaps: [],
      alreadyDemonstrated: ["inverse operations"],
    };
    const planA = coursePlan(["Inverse operations", "Balance equations", "Variables on both sides", "Linear applications"]);
    const planB = coursePlan(["Variables on both sides", "Equation transformations", "Modeling constraints", "Linear applications"]);
    const prompts: string[] = [];
    const scripted = (plan: ReturnType<typeof coursePlan>): Generate => async ({ prompt }) => {
      prompts.push(prompt);
      if (prompt.includes("Solve this multiple-choice question yourself")) return JSON.stringify({ choice: 1 });
      return JSON.stringify(plan);
    };
    const resultA = JSON.parse(await runTutor(scripted(planA), "course", learnerA));
    const resultB = JSON.parse(await runTutor(scripted(planB), "course", learnerB));
    // Answer-verification solves are interleaved with the two course requests; compare only the latter.
    const coursePrompts = prompts.filter((prompt) => !prompt.includes("Solve this multiple-choice question yourself"));
    expect(coursePrompts[0]).toContain("Needs more practice");
    expect(coursePrompts[1]).toContain("Demonstrated under current criteria");
    expect(courseSchema.parse(resultA).phases[0]?.topics[0]?.name).toBe("Inverse operations");
    expect(courseSchema.parse(resultB).phases[0]?.topics[0]?.name).toBe("Variables on both sides");
    expect(resultA.phases[0].topics[0].name).not.toBe(resultB.phases[0].topics[0].name);
  });

  it("regenerates an assignment when an independent solve disagrees with its answer key", async () => {
    const plan = coursePlan(["Fractions", "Ratios", "Rates", "Proportions"]);
    let solveCount = 0;
    let generationCount = 0;
    const generate: Generate = async ({ prompt }) => {
      if (prompt.includes("Solve this multiple-choice question yourself")) {
        return JSON.stringify({ choice: solveCount++ === 0 ? 0 : 1 });
      }
      generationCount++;
      return JSON.stringify(plan);
    };
    const result = JSON.parse(await runTutor(generate, "course", {}));
    expect(generationCount).toBe(2);
    expect(result.phases).toHaveLength(2);
  });

  it("includes learner pace, level, goal, and supplied material in course instructions", () => {
    const prompt = promptFor("course", {
      wantsToLearn: "Prepare for a mechanics exam",
      selfReportedLevel: "Somewhat comfortable",
      studyMinutesPerSession: 20,
      learningMaterial: "Class notes: free body diagrams",
      diagnosticResults: [{ concept: "forces", status: "Progressing" }],
    });
    expect(prompt).toContain("Prepare for a mechanics exam");
    expect(prompt).toContain("Somewhat comfortable");
    expect(prompt).toContain("20");
    expect(prompt).toContain("free body diagrams");
    expect(prompt).toContain("diagnosticResults");
  });

  it("keeps assignment answers and written reference criteria server-held", async () => {
    const raw = JSON.stringify(coursePlan(["Fractions", "Ratios", "Rates", "Proportions"]));
    const safe = JSON.parse(await protectCoursePlan(raw, signingSecret));
    const parsed = publicCourseSchema.parse(safe);
    const assessment = parsed.phases[0]!.assessment;
    expect(assessment.objectiveQuestions?.[0]).not.toHaveProperty("correctIndex");
    expect(assessment.objectiveQuestions?.[0]).not.toHaveProperty("explanation");
    expect(assessment.openQuestions?.[0]).not.toHaveProperty("referenceCriteria");
    expect(assessment.openQuestions?.[0]).not.toHaveProperty("rubric");
    const privateAssignment = await openCourseAssessment(assessment.answerToken!, signingSecret);
    expect(privateAssignment).toMatchObject({
      phaseId: "foundations",
      objectiveQuestions: [{ correctIndex: 1 }],
      openQuestions: [{ referenceCriteria: "The answer should preserve equality.", rubric: [{ points: 2 }] }],
    });
  });
});
