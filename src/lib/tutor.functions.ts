import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { pickProvider } from "./ai-provider.server";
import { RateLimiter } from "./rate-limit";
import { runTutor } from "./tutor-core";
import { ACTIONS } from "./tutor-schemas";

const input = z.object({
  action: z.enum(ACTIONS),
  payload: z.record(z.string(), z.unknown()).default({}),
});

// Per server instance. Each tutor action can cost several model calls (generate + verify).
const perMinute = new RateLimiter(20, 60_000);
const perDay = new RateLimiter(300, 24 * 60 * 60_000);

function callerKey(): string {
  const h = getRequest()?.headers;
  const ip = h?.get("cf-connecting-ip") ?? h?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return ip;
}

export const askTutor = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const parsed = input.parse(d);
    if (JSON.stringify(parsed.payload).length > 20_000) throw new Error("Input too long");
    return parsed;
  })
  .handler(async ({ data }) => {
    const key = callerKey();
    if (!perMinute.take(key) || !perDay.take(key)) {
      throw new Error("Too many requests right now. Wait a moment and retry.");
    }
    const json = await runTutor(pickProvider(process.env), data.action, data.payload);
    return { json };
  });
