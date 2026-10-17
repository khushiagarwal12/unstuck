import { z } from "zod";

const style = z.enum(["visual", "example", "hint", "simpler", "analogy", "prerequisite"]);
const option = z.object({ text: z.string().max(300) });
const hypothesis = z.object({
  label: z.string().max(120),
  summary: z.string().max(400),
  confidence: z.enum(["low", "medium", "high"]),
});
const lesson = z.object({
  title: z.string().max(120),
  body: z.string().max(2500),
  diagram: z.string().max(1500).nullable(),
  steps: z.array(z.string().max(400)).max(8),
  style,
});
const snapshotSchema = z.object({
  stage: z.enum(["start", "diagnostic", "diagnosis", "lesson", "transfer", "done"]),
  topic: z.string().max(20_000),
  notes: z.string().max(20_000),
  diag: z
    .object({
      concept: z.string().max(80),
      question: z.string().max(700),
      options: z.array(option).length(4),
      answerToken: z.string().max(4096),
      why: z.string().max(300),
    })
    .nullable(),
  picked: z.number().int().min(0).max(3).nullable(),
  diagnosticCorrect: z.boolean().nullable(),
  diagnosis: z
    .object({
      demonstrated: z.array(z.string().max(300)).max(4),
      hypotheses: z.array(hypothesis).min(1).max(3),
      unresolved: z.array(z.string().max(300)).max(4),
      needsFollowUp: z.boolean(),
      followUp: z
        .object({
          question: z.string().max(500),
          options: z.array(z.string().max(300)).min(2).max(4),
          why: z.string().max(300),
        })
        .nullable(),
      recommendedStyle: style,
    })
    .nullable(),
  followUps: z.array(z.object({ q: z.string().max(500), a: z.string().max(300) })).max(2),
  disputed: z.array(z.string().max(120)).max(3),
  lesson: lesson.nullable(),
  styles: z.array(style).max(1000),
  transfer: z
    .object({
      question: z.string().max(700),
      options: z.array(z.string().max(300)).length(4),
      answerToken: z.string().max(4096),
      context: z.string().max(60),
      explanation: z.string().max(700).optional(),
    })
    .nullable(),
  tPick: z.number().int().min(0).max(3).nullable(),
  history: z
    .array(
      z.object({
        context: z.string().max(60),
        correct: z.boolean(),
        clean: z.boolean(),
      }),
    )
    .max(1000),
});

export type SessionSnapshot = z.infer<typeof snapshotSchema>;

export function shouldRestoreSession(snapshot: SessionSnapshot, initialTopic?: string): boolean {
  return !initialTopic?.trim() || (snapshot.stage !== "start" && snapshot.stage !== "done");
}

export function readSession(
  storage: Pick<Storage, "getItem">,
  key: string,
): SessionSnapshot | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  return snapshotSchema.parse(JSON.parse(raw));
}

export function writeSession(
  storage: Pick<Storage, "setItem">,
  key: string,
  snapshot: SessionSnapshot,
): void {
  storage.setItem(key, JSON.stringify(snapshotSchema.parse(snapshot)));
}

export function clearSession(storage: Pick<Storage, "removeItem">, key: string): void {
  storage.removeItem(key);
}

export function adoptGuestSession(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  userId: string,
): void {
  const userKey = `unstuck.user-session.v1:${userId}`;
  if (storage.getItem(userKey)) return;
  const guest = readSession(storage, "unstuck.guest-session.v1");
  if (!guest) return;
  writeSession(storage, userKey, guest);
  clearSession(storage, "unstuck.guest-session.v1");
}
