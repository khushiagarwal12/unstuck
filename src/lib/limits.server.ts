import { getRequest } from "@tanstack/react-start/server";

import { RateLimiter } from "./rate-limit";

// Per server instance. A tutor action can cost several model calls (generate + verify).
const perMinute = new RateLimiter(20, 60_000);
const perDay = new RateLimiter(300, 24 * 60 * 60_000);

function callerKey(): string {
  const h = getRequest()?.headers;
  return h?.get("cf-connecting-ip") ?? h?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export function enforceLimits(): void {
  const key = callerKey();
  if (!perMinute.take(key) || !perDay.take(key)) {
    throw new Error("Too many requests right now. Wait a moment and retry.");
  }
}
