import { describe, expect, it } from "vitest";

import { promptFor } from "@/lib/tutor-prompts";
import { type Generate, runTutor } from "@/lib/tutor-core";
import { courseSchema } from "@/lib/tutor-schemas";

function coursePlan(topicNames: [string, string, string, string]) {
  const topic = (id: string, name: string, prerequisite: string[] = []) => ({
    id, name, why: `Supports the learner's goal of ${name}.`, covers: [name],
    prerequisites: prerequisite, objectives: [`Explain ${name}`],
    subtopics: [{ name: `${name} foundations`, objective: `Describe ${name}` }],
    lesson: {
      explanation: `A focused explanation of ${name}.`,
      examples: [{ prompt: `Example of ${name}`, walkthrough: `Work through ${name}.` }],
      guidedPractice: [{ prompt: `Practice ${name}`, hint: `Consider ${name}.`, successCriteria: `Use ${name} correctly.` }],
    },
    minutes: 15,
  });
  return {
    title: `Journey for ${topicNames[0]}`,
    goal: `Learn ${topicNames[3]}`,
    outcomes: [`Apply ${topicNames[3]}`],
    phases: [
      { id: "foundations", title: "Foundations", purpose: "Build the needed foundations.", topics: [topic("topic-1", topicNames[0]), topic("topic-2", topicNames[1], ["topic-1"])], assessment: { title: "Foundation check", purpose: "Apply both foundations.", tasks: ["Explain and apply the ideas."], rubric: ["Accurate explanation", "Correct application"], passCriteria: "Meet both rubric criteria." } },
      { id: "application", title: "Application", purpose: "Apply the foundations to the goal.", topics: [topic("topic-3", topicNames[2], ["topic-2"]), topic("topic-4", topicNames[3], ["topic-3"])], assessment: { title: "Goal challenge", purpose: "Demonstrate transfer.", tasks: ["Solve a new problem and explain your reasoning."], rubric: ["Correct result", "Sound reasoning"], passCriteria: "Meet both rubric criteria." } },
    ],
  };
}

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
      return JSON.stringify(plan);
    };
    const resultA = JSON.parse(await runTutor(scripted(planA), "course", learnerA));
    const resultB = JSON.parse(await runTutor(scripted(planB), "course", learnerB));
    expect(prompts[0]).toContain("Needs more practice");
    expect(prompts[1]).toContain("Demonstrated under current criteria");
    expect(courseSchema.parse(resultA).phases[0]?.topics[0]?.name).toBe("Inverse operations");
    expect(courseSchema.parse(resultB).phases[0]?.topics[0]?.name).toBe("Variables on both sides");
    expect(resultA.phases[0].topics[0].name).not.toBe(resultB.phases[0].topics[0].name);
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
});
