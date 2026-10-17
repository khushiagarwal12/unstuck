import { z } from "zod";

const boundedText = z.string().trim().max(1200);

export const assignmentPayloadSchema = z.object({
  phaseId: z.string().min(1).max(40),
  objectiveQuestions: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        objective: z.string().min(1).max(200),
        question: z.string().min(1).max(500),
        options: z.array(z.string().min(1).max(240)).length(4),
        correctIndex: z.number().int().min(0).max(3),
        explanation: z.string().min(1).max(500),
        hint: z.string().min(1).max(300),
        points: z.number().int().min(1).max(10),
      }),
    )
    .min(1)
    .max(3),
  openQuestions: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        objective: z.string().min(1).max(200),
        prompt: z.string().min(1).max(500),
        referenceCriteria: z.string().min(1).max(700),
        rubric: z
          .array(
            z.object({
              criterion: z.string().min(1).max(200),
              points: z.number().int().min(1).max(5),
            }),
          )
          .min(1)
          .max(4),
      }),
    )
    .min(1)
    .max(2),
});

export const subjectiveGradeSchema = z.object({
  questionId: z.string().min(1).max(40),
  criteria: z
    .array(
      z.object({
        criterion: z.string().min(1).max(200),
        score: z.number().int().min(0).max(5),
        evidence: boundedText,
      }),
    )
    .min(1)
    .max(4),
  feedback: z.string().min(1).max(500),
  needsFollowUp: z.boolean(),
  followUpQuestion: z.string().max(400).nullable(),
});

export const subjectiveGradesSchema = z.object({
  grades: z.array(subjectiveGradeSchema).max(2),
});

export type AssignmentPayload = z.infer<typeof assignmentPayloadSchema>;
export type SubjectiveGrade = z.infer<typeof subjectiveGradeSchema>;

export function validateSubjectiveGrades(
  assignment: AssignmentPayload,
  grades: z.infer<typeof subjectiveGradesSchema>,
  writtenAnswers: Record<string, string>,
): SubjectiveGrade[] {
  if (grades.grades.length !== assignment.openQuestions.length) {
    throw new Error("The written responses could not be evaluated consistently. Please try again.");
  }
  if (new Set(grades.grades.map((item) => item.questionId)).size !== grades.grades.length) {
    throw new Error("The written responses could not be evaluated consistently. Please try again.");
  }
  return assignment.openQuestions.map((question) => {
    const grade = grades.grades.find((item) => item.questionId === question.id);
    if (
      !grade ||
      grade.criteria.length !== question.rubric.length ||
      new Set(grade.criteria.map((item) => item.criterion)).size !== grade.criteria.length
    ) {
      throw new Error(
        "The written responses could not be evaluated consistently. Please try again.",
      );
    }
    const criteria = question.rubric.map((criterion) => {
      const scored = grade.criteria.find((item) => item.criterion === criterion.criterion);
      if (!scored || scored.score > criterion.points) {
        throw new Error(
          "The written responses could not be evaluated consistently. Please try again.",
        );
      }
      const quote = scored.evidence.trim().toLowerCase();
      const answer = writtenAnswers[question.id]?.toLowerCase() ?? "";
      if (quote !== "no evidence in response" && (!quote || !answer.includes(quote))) {
        throw new Error(
          "The written response feedback could not be grounded in the learner's response. Please retry.",
        );
      }
      if (scored.score > 0 && quote === "no evidence in response") {
        throw new Error(
          "The written response feedback could not be grounded in the learner's response. Please retry.",
        );
      }
      return scored;
    });
    if (grade.needsFollowUp !== (grade.followUpQuestion !== null)) {
      throw new Error(
        "The written responses could not be evaluated consistently. Please try again.",
      );
    }
    return { ...grade, criteria };
  });
}

export type AssignmentResponse = {
  objectiveAnswers: Record<string, number>;
  writtenAnswers: Record<string, string>;
};

export type AssignmentResult = {
  score: number;
  maxScore: number;
  percentage: number;
  passed: boolean;
  independent: boolean;
  hintsUsed: number;
  retryCount: number;
  objectiveResults: {
    questionId: string;
    objective: string;
    correct: boolean;
    pointsEarned: number;
    pointsPossible: number;
    explanation: string;
  }[];
  writtenResults: {
    questionId: string;
    objective: string;
    pointsEarned: number;
    pointsPossible: number;
    feedback: string;
    criteria: (SubjectiveGrade["criteria"][number] & { pointsPossible: number })[];
  }[];
  needsFollowUp: boolean;
  followUpQuestionId: string | null;
  followUpQuestion: string | null;
  recommendedAction:
    | "advance"
    | "advance-with-reinforcement"
    | "clarify-reasoning"
    | "targeted-remediation"
    | "prerequisite-review";
  nextSteps: string[];
};

export const assignmentResultSchema = z
  .object({
    score: z.number().int().min(0),
    maxScore: z.number().int().min(1),
    percentage: z.number().int().min(0).max(100),
    passed: z.boolean(),
    independent: z.boolean(),
    hintsUsed: z.number().int().min(0).max(10),
    retryCount: z.number().int().min(0).max(50),
    objectiveResults: z
      .array(
        z.object({
          questionId: z.string().min(1).max(40),
          objective: z.string().min(1).max(200),
          correct: z.boolean(),
          pointsEarned: z.number().int().min(0),
          pointsPossible: z.number().int().min(1),
          explanation: z.string().min(1).max(500),
        }),
      )
      .max(3),
    writtenResults: z
      .array(
        z.object({
          questionId: z.string().min(1).max(40),
          objective: z.string().min(1).max(200),
          pointsEarned: z.number().int().min(0),
          pointsPossible: z.number().int().min(1),
          feedback: z.string().min(1).max(500),
          criteria: z
            .array(
              z.object({
                criterion: z.string().min(1).max(200),
                score: z.number().int().min(0).max(5),
                evidence: boundedText,
                pointsPossible: z.number().int().min(1).max(5),
              }),
            )
            .max(4),
        }),
      )
      .max(2),
    needsFollowUp: z.boolean(),
    followUpQuestionId: z.string().max(40).nullable(),
    followUpQuestion: z.string().max(400).nullable(),
    recommendedAction: z.enum([
      "advance",
      "advance-with-reinforcement",
      "clarify-reasoning",
      "targeted-remediation",
      "prerequisite-review",
    ]),
    nextSteps: z.array(z.string().min(1).max(300)).max(3),
  })
  .refine(
    (result) =>
      result.needsFollowUp ===
      (result.followUpQuestion !== null && result.followUpQuestionId !== null),
    { message: "Follow-up state must include its question." },
  )
  .refine(
    (result) =>
      result.score <= result.maxScore &&
      Math.round((result.score / result.maxScore) * 100) === result.percentage &&
      result.passed === (result.percentage >= 80 && !result.needsFollowUp) &&
      result.independent === (result.passed && result.hintsUsed === 0 && result.retryCount === 0) &&
      result.score ===
        [...result.objectiveResults, ...result.writtenResults].reduce(
          (sum, item) => sum + item.pointsEarned,
          0,
        ) &&
      result.maxScore ===
        [...result.objectiveResults, ...result.writtenResults].reduce(
          (sum, item) => sum + item.pointsPossible,
          0,
        ) &&
      result.writtenResults.every(
        (item) =>
          item.criteria.reduce((sum, criterion) => sum + criterion.score, 0) ===
            item.pointsEarned &&
          item.criteria.reduce((sum, criterion) => sum + criterion.pointsPossible, 0) ===
            item.pointsPossible &&
          item.criteria.every((criterion) => criterion.score <= criterion.pointsPossible),
      ) &&
      result.objectiveResults.every((item) => item.pointsEarned <= item.pointsPossible),
    { message: "Assessment result totals and progression decision must be consistent." },
  );

export function scoreAssignment(
  assignment: AssignmentPayload,
  response: AssignmentResponse,
  subjectiveGrades: SubjectiveGrade[],
  hintsUsed: number,
  retryCount: number,
): AssignmentResult {
  const objectiveResults = assignment.objectiveQuestions.map((question) => {
    const correct = response.objectiveAnswers[question.id] === question.correctIndex;
    return {
      questionId: question.id,
      objective: question.objective,
      correct,
      pointsEarned: correct ? question.points : 0,
      pointsPossible: question.points,
      explanation: question.explanation,
    };
  });
  const writtenResults = assignment.openQuestions.map((question) => {
    const grade = subjectiveGrades.find((item) => item.questionId === question.id);
    if (!grade) throw new Error("A written response is missing rubric feedback.");
    const criteria = grade.criteria.map((item) => {
      const rubricCriterion = question.rubric.find(
        (criterion) => criterion.criterion === item.criterion,
      );
      if (!rubricCriterion) throw new Error("A written response is missing rubric feedback.");
      return { ...item, pointsPossible: rubricCriterion.points };
    });
    return {
      questionId: question.id,
      objective: question.objective,
      pointsEarned: grade.criteria.reduce((sum, item) => sum + item.score, 0),
      pointsPossible: question.rubric.reduce((sum, item) => sum + item.points, 0),
      feedback: grade.feedback,
      criteria,
    };
  });
  const score = [...objectiveResults, ...writtenResults].reduce(
    (sum, result) => sum + result.pointsEarned,
    0,
  );
  const maxScore = [...objectiveResults, ...writtenResults].reduce(
    (sum, result) => sum + result.pointsPossible,
    0,
  );
  const percentage = Math.round((score / maxScore) * 100);
  const followUp = subjectiveGrades.find((grade) => grade.needsFollowUp);
  const followUpQuestion = followUp
    ? assignment.openQuestions.find((question) => question.id === followUp.questionId)
    : undefined;
  const passed = percentage >= 80 && !followUp;
  const independent = passed && hintsUsed === 0 && retryCount === 0;
  const recommendedAction: AssignmentResult["recommendedAction"] = followUp
    ? "clarify-reasoning"
    : percentage >= 80
      ? independent
        ? "advance"
        : "advance-with-reinforcement"
      : percentage >= 50
        ? "targeted-remediation"
        : "prerequisite-review";
  const nextSteps = followUp
    ? ["Answer the follow-up so we can distinguish a correct result from clear reasoning."]
    : percentage >= 80
      ? independent
        ? [
            "Continue to the next phase. This assessment score does not by itself establish independent mastery.",
          ]
        : [
            "Continue with a short independent check in the next phase; hints or retries supported this result.",
          ]
      : percentage >= 50
        ? ["Review the objectives with missed rubric criteria, then retry the phase assignment."]
        : [
            "Revisit the prerequisite concepts for the missed objectives before retrying the assignment.",
          ];
  return {
    score,
    maxScore,
    percentage,
    passed,
    independent,
    hintsUsed,
    retryCount,
    objectiveResults,
    writtenResults,
    needsFollowUp: !!followUp,
    followUpQuestionId: followUpQuestion?.id ?? null,
    followUpQuestion: followUp?.followUpQuestion ?? null,
    recommendedAction,
    nextSteps,
  };
}
