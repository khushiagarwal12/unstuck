import { sealCourseAssessment } from "./answer-key.server";
import { assignmentPayloadSchema } from "./course-assessment";
import { courseSchema, publicCourseSchema } from "./tutor-schemas";

export async function protectCoursePlan(json: string, secret: string | undefined): Promise<string> {
  const parsed = courseSchema.parse(JSON.parse(json));
  const phases = await Promise.all(parsed.phases.map(async (phase) => {
    const payload = assignmentPayloadSchema.parse({
      phaseId: phase.id,
      objectiveQuestions: phase.assessment.objectiveQuestions,
      openQuestions: phase.assessment.openQuestions.map(({ id, objective, prompt, referenceCriteria, rubric }) =>
        ({ id, objective, prompt, referenceCriteria, rubric })),
    });
    const answerToken = await sealCourseAssessment(payload, secret);
    return {
      ...phase,
      assessment: {
        title: phase.assessment.title,
        purpose: phase.assessment.purpose,
        passCriteria: phase.assessment.passCriteria,
        objectiveQuestions: phase.assessment.objectiveQuestions.map(({ correctIndex: _correctIndex, explanation: _explanation, ...question }) => question),
        openQuestions: phase.assessment.openQuestions.map(({ id, objective, prompt, hint }) => ({ id, objective, prompt, hint })),
        answerToken,
      },
    };
  }));
  return JSON.stringify(publicCourseSchema.parse({ ...parsed, phases }));
}
