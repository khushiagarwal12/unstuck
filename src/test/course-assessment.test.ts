import { describe, expect, it } from "vitest";

import {
  assignmentPayloadSchema,
  scoreAssignment,
  subjectiveGradesSchema,
  validateSubjectiveGrades,
} from "@/lib/course-assessment";

const assignment = assignmentPayloadSchema.parse({
  phaseId: "phase-one",
  objectiveQuestions: [
    {
      id: "objective-1",
      objective: "Apply the phase concept",
      question: "Which result is correct?",
      options: ["0", "1", "2", "3"],
      correctIndex: 1,
      explanation: "Applying the operation gives 1.",
      hint: "Check both sides.",
      points: 2,
    },
  ],
  openQuestions: [
    {
      id: "open-1",
      objective: "Explain the reasoning",
      prompt: "Explain why the result is valid.",
      referenceCriteria: "The response must explain that the same operation preserves equality.",
      rubric: [{ criterion: "Explains preserving equality", points: 2 }],
    },
  ],
});

const grade = (
  score: number,
  needsFollowUp = false,
  evidence = score ? "the same operation preserves equality" : "No evidence in response",
) =>
  validateSubjectiveGrades(
    assignment,
    subjectiveGradesSchema.parse({
      grades: [
        {
          questionId: "open-1",
          criteria: [{ criterion: "Explains preserving equality", score, evidence }],
          feedback: "Use the equality property explicitly.",
          needsFollowUp,
          followUpQuestion: needsFollowUp ? "What operation was applied to both sides?" : null,
        },
      ],
    }),
    { "open-1": "The same operation preserves equality. It is 1. I don't know." },
  );

describe("phase assignment scoring and progression", () => {
  it("passes a high independently completed assignment without treating it as mastery", () => {
    const result = scoreAssignment(
      assignment,
      {
        objectiveAnswers: { "objective-1": 1 },
        writtenAnswers: { "open-1": "The same operation preserves equality." },
      },
      grade(2),
      0,
      0,
    );
    expect(result.percentage).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.independent).toBe(true);
    expect(result.recommendedAction).toBe("advance");
    expect(result.nextSteps.join(" ")).toContain(
      "does not by itself establish independent mastery",
    );
  });

  it("routes partial performance to targeted remediation", () => {
    const result = scoreAssignment(
      assignment,
      { objectiveAnswers: { "objective-1": 1 }, writtenAnswers: { "open-1": "I am not sure." } },
      grade(0),
      0,
      0,
    );
    expect(result.percentage).toBe(50);
    expect(result.passed).toBe(false);
    expect(result.recommendedAction).toBe("targeted-remediation");
  });

  it("routes low performance to prerequisite review", () => {
    const result = scoreAssignment(
      assignment,
      { objectiveAnswers: { "objective-1": 3 }, writtenAnswers: { "open-1": "I don't know." } },
      grade(0),
      0,
      0,
    );
    expect(result.percentage).toBe(0);
    expect(result.recommendedAction).toBe("prerequisite-review");
  });

  it("asks for clarification when the answer is right but reasoning remains ambiguous", () => {
    const result = scoreAssignment(
      assignment,
      { objectiveAnswers: { "objective-1": 1 }, writtenAnswers: { "open-1": "It is 1." } },
      grade(2, true, "It is 1."),
      0,
      0,
    );
    expect(result.percentage).toBe(100);
    expect(result.passed).toBe(false);
    expect(result.needsFollowUp).toBe(true);
    expect(result.followUpQuestionId).toBe("open-1");
    expect(result.recommendedAction).toBe("clarify-reasoning");
  });

  it("records retakes and hints without calling supported success independent", () => {
    const result = scoreAssignment(
      assignment,
      {
        objectiveAnswers: { "objective-1": 1 },
        writtenAnswers: { "open-1": "The same operation preserves equality." },
      },
      grade(2),
      1,
      2,
    );
    expect(result.passed).toBe(true);
    expect(result.independent).toBe(false);
    expect(result.hintsUsed).toBe(1);
    expect(result.retryCount).toBe(2);
    expect(result.recommendedAction).toBe("advance-with-reinforcement");
  });

  it("rejects rubric points backed by an evidence quote absent from the response", () => {
    const ungrounded = subjectiveGradesSchema.parse({
      grades: [
        {
          questionId: "open-1",
          criteria: [
            { criterion: "Explains preserving equality", score: 2, evidence: "invented evidence" },
          ],
          feedback: "Good work.",
          needsFollowUp: false,
          followUpQuestion: null,
        },
      ],
    });
    expect(() =>
      validateSubjectiveGrades(assignment, ungrounded, { "open-1": "The answer is 1." }),
    ).toThrow(/grounded/);
  });
});
