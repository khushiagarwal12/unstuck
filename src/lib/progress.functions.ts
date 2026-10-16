import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const record = z.object({
  concept: z.string().trim().min(1).max(200),
  status: z.enum(["Not assessed", "Needs more practice", "Progressing", "Demonstrated under current criteria"]),
  misconceptions: z.array(z.string().max(400)).max(10),
  styles: z.array(z.enum(["visual", "example", "hint", "simpler", "analogy", "prerequisite"])).max(20),
  hintsUsed: z.number().int().min(0).max(100),
  correct: z.boolean(),
  clean: z.boolean(),
  explanation: z.string().max(3000).nullable(),
});

const importInput = z.object({
  conversionId: z.string().uuid(),
  events: z.array(z.object({
    id: z.string().uuid(),
    savedAt: z.string().datetime(),
    record,
  })).max(500),
});

export const importGuestProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => importInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: imported, error } = await context.supabase.rpc("import_guest_progress", {
      p_conversion_id: data.conversionId,
      p_records: data.events,
    });
    if (error) {
      console.error("[progress] Guest progress import failed", error);
      throw new Error("We couldn't safely import your guest progress. Your guest copy is still saved on this device.");
    }
    return { imported };
  });
