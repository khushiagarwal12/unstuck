import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { pickProvider } from "./ai-provider.server";
import { enforceLimits } from "./limits.server";
import { runTutor } from "./tutor-core";
import { ACTIONS } from "./tutor-schemas";

const input = z.object({
  action: z.enum(ACTIONS),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const askTutor = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const parsed = input.parse(d);
    if (JSON.stringify(parsed.payload).length > 20_000) throw new Error("Input too long");
    return parsed;
  })
  .handler(async ({ data }) => {
    enforceLimits();
    const json = await runTutor(pickProvider(process.env), data.action, data.payload);
    return { json };
  });
