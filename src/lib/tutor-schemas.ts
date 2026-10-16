import { z } from "zod";

export const ACTIONS = ["start", "diagnose", "intervene", "transfer", "course", "coach"] as const;
export type Action = (typeof ACTIONS)[number];

const text = (max = 600) => z.string().trim().min(1).max(max);
const STYLES = ["visual", "example", "hint", "simpler", "analogy", "prerequisite"] as const;

const distinct = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase())).size === xs.length;

export const startSchema = z
  .object({
    concept: text(80),
    question: text(700),
    options: z.array(z.object({ text: text(300), misconception: z.string().trim().max(300).nullable() })).length(4),
    correctIndex: z.number().int().min(0).max(3),
    why: text(300),
  })
  .refine((q) => distinct(q.options.map((o) => o.text)), { message: "options must be different" });

export const transferSchema = z
  .object({
    question: text(700),
    options: z.array(text(300)).length(4),
    correctIndex: z.number().int().min(0).max(3),
    context: text(60),
    explanation: text(700),
  })
  .refine((q) => distinct(q.options), { message: "options must be different" });

export const diagnoseSchema = z.object({
  demonstrated: z.array(text(300)).max(4),
  hypotheses: z
    .array(z.object({ label: text(120), summary: text(400), confidence: z.enum(["low", "medium", "high"]) }))
    .min(1)
    .max(3),
  unresolved: z.array(text(300)).max(4),
  needsFollowUp: z.boolean(),
  followUp: z
    .object({ question: text(500), options: z.array(text(300)).min(2).max(4), why: text(300) })
    .nullable(),
  recommendedStyle: z.enum(STYLES),
});

export const interveneSchema = z.object({
  title: text(120),
  body: text(2500),
  diagram: z.string().max(1500).nullable(),
  steps: z.array(text(400)).max(8),
});

export const courseSchema = z.object({
  title: text(120),
  goal: z.string().trim().max(300),
  outcomes: z.array(text(200)).min(1).max(6),
  phases: z.array(z.object({
    id: text(40).regex(/^[a-z0-9-]+$/),
    title: text(100),
    purpose: text(300),
    topics: z.array(z.object({
      id: text(40).regex(/^[a-z0-9-]+$/),
      name: text(80),
      why: text(300),
      covers: z.array(text(80)).min(1).max(4),
      prerequisites: z.array(text(40)).max(4),
      objectives: z.array(text(200)).min(1).max(5),
      subtopics: z.array(z.object({
        name: text(80),
        objective: text(200),
      })).min(1).max(5),
      lesson: z.object({
        explanation: text(1800),
        examples: z.array(z.object({
          prompt: text(300),
          walkthrough: text(800),
        })).min(1).max(3),
        guidedPractice: z.array(z.object({
          prompt: text(300),
          hint: text(300),
          successCriteria: text(300),
        })).min(1).max(3),
      }),
      minutes: z.number().int().min(1).max(120),
    })).min(1).max(4),
    assessment: z.object({
      title: text(100),
      purpose: text(300),
      tasks: z.array(text(500)).min(1).max(4),
      rubric: z.array(text(300)).min(2).max(5),
      passCriteria: text(300),
    }),
  })).min(2).max(5),
});

export const coachSchema = z.object({
  greeting: text(200),
  focus: text(300),
  tip: text(300),
});

export const solveSchema = z.object({ choice: z.number().int().min(0).max(3) });

export const schemas = {
  start: startSchema,
  transfer: transferSchema,
  diagnose: diagnoseSchema,
  intervene: interveneSchema,
  course: courseSchema,
  coach: coachSchema,
} as const;
export type CoursePlan = z.infer<typeof courseSchema>;

export const MAX_FOLLOW_UPS = 2;

/** Rules the model cannot be trusted to follow on its own. */
export function normalize(action: Action, value: unknown, payload: Record<string, unknown>): unknown {
  if (action === "diagnose") {
    const d = value as z.infer<typeof diagnoseSchema>;
    const asked = Number(payload["followUpCount"] ?? 0);
    const wants = d.needsFollowUp && d.followUp !== null && asked < MAX_FOLLOW_UPS;
    const observedAnswers = (typeof payload["learnerAnswer"] === "string" ? 1 : 0) +
      (Array.isArray(payload["followUpAnswers"]) ? Math.min(payload["followUpAnswers"].length, MAX_FOLLOW_UPS) : 0);
    const maxConfidence = observedAnswers < 2 ? "low" : observedAnswers < 3 ? "medium" : "high";
    const confidenceRank = { low: 0, medium: 1, high: 2 } as const;
    const disputed = new Set(Array.isArray(payload["disputedHypotheses"]) ? payload["disputedHypotheses"] : []);
    const hypotheses = d.hypotheses.map((h) => ({
      ...h,
      confidence: disputed.has(h.label)
        ? "low"
        : confidenceRank[h.confidence] > confidenceRank[maxConfidence] ? maxConfidence : h.confidence,
    }));
    return { ...d, hypotheses, needsFollowUp: wants, followUp: wants ? d.followUp : null };
  }
  if (action === "course") {
    const c = value as z.infer<typeof courseSchema>;
    const seen = new Set<string>();
    const phaseIds = new Set<string>();
    let topicCount = 0;
    const phases = c.phases.map((phase) => {
      if (phaseIds.has(phase.id)) throw new Error("Course phases must have distinct ids.");
      phaseIds.add(phase.id);
      const topics = phase.topics.map((topic) => {
        if (seen.has(topic.id)) throw new Error("Course topics must have distinct ids.");
        topicCount++;
        const prerequisites = topic.prerequisites.filter((id) => seen.has(id));
        seen.add(topic.id);
        return { ...topic, prerequisites };
      });
      return { ...phase, topics };
    });
    if (topicCount < 4) throw new Error("A course plan needs at least four learning topics.");
    return {
      ...c,
      phases,
      topics: phases.flatMap((phase) => phase.topics.map((topic) => ({
        id: topic.id,
        name: topic.name,
        why: topic.why,
        prerequisites: topic.prerequisites,
        minutes: topic.minutes,
      }))),
    };
  }
  return value;
}

/** Strip code fences and anything around the outermost JSON object. */
export function extractJson(raw: string): string {
  const s = raw.replace(/^```(?:json)?/im, "").replace(/```\s*$/m, "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  return a >= 0 && b > a ? s.slice(a, b + 1) : s;
}
