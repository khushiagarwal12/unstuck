import { z } from "zod";

import type { SessionRecord } from "@/components/LearnSession";

const recordSchema = z.object({
  concept: z.string().trim().min(1).max(200),
  status: z.enum([
    "Not assessed",
    "Needs more practice",
    "Progressing",
    "Demonstrated under current criteria",
  ]),
  misconceptions: z.array(z.string().max(400)).max(10),
  styles: z
    .array(z.enum(["visual", "example", "hint", "simpler", "analogy", "prerequisite"]))
    .max(20),
  hintsUsed: z.number().int().min(0).max(100),
  correct: z.boolean(),
  clean: z.boolean(),
  explanation: z.string().max(3000).nullable(),
});

const eventSchema = z.object({
  id: z.string().uuid(),
  savedAt: z.string().datetime(),
  record: recordSchema,
});

const bundleSchema = z.object({
  version: z.literal(1),
  conversionId: z.string().uuid(),
  events: z.array(eventSchema).max(500),
});

export type GuestProgressBundle = z.infer<typeof bundleSchema>;
export const GUEST_PROGRESS_KEY = "unstuck.guest-progress.v1";

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function")
    throw new Error("This browser can't securely save guest progress.");
  return globalThis.crypto.randomUUID();
}

export function readGuestProgress(
  storage: Pick<Storage, "getItem">,
  newConversionId?: string,
): GuestProgressBundle {
  const raw = storage.getItem(GUEST_PROGRESS_KEY);
  if (!raw) return { version: 1, conversionId: newConversionId ?? createId(), events: [] };
  const parsed: unknown = JSON.parse(raw);
  return bundleSchema.parse(parsed);
}

export function appendGuestProgress(
  bundle: GuestProgressBundle,
  record: SessionRecord,
  id = createId(),
  savedAt = new Date().toISOString(),
): GuestProgressBundle {
  return bundleSchema.parse({
    ...bundle,
    events: [...bundle.events, { id, savedAt, record }],
  });
}

export function clearGuestProgress(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  conversionId: string,
  importedEventIds: string[],
  nextConversionId?: string,
): void {
  const current = storage.getItem(GUEST_PROGRESS_KEY);
  if (!current) return;
  const parsed = bundleSchema.safeParse(JSON.parse(current));
  if (!parsed.success || parsed.data.conversionId !== conversionId) return;
  const imported = new Set(importedEventIds);
  const remaining = parsed.data.events.filter((event) => !imported.has(event.id));
  if (remaining.length === 0) {
    storage.removeItem(GUEST_PROGRESS_KEY);
  } else {
    storage.setItem(
      GUEST_PROGRESS_KEY,
      JSON.stringify({
        version: 1,
        conversionId: nextConversionId ?? createId(),
        events: remaining,
      }),
    );
  }
}
