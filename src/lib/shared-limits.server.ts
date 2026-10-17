import { createHash } from "node:crypto";
import { getRequest } from "@tanstack/react-start/server";

import { firestore } from "@/integrations/firebase/admin.server";
import { clientAddress } from "./client-address.server";

const perMinuteLimit = 20;
const perDayLimit = 300;

function callerIdentity(userId?: string) {
  if (userId) return `user:${userId}`;
  return `guest:${clientAddress(getRequest()?.headers)}`;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function enforceSharedLimits(userId?: string): Promise<void> {
  const now = Date.now();
  const identity = digest(callerIdentity(userId));
  const minuteId = `${identity}-m-${Math.floor(now / 60_000)}`;
  const dayId = `${identity}-d-${Math.floor(now / 86_400_000)}`;
  const minuteRef = firestore().collection("systemRateLimits").doc(minuteId);
  const dayRef = firestore().collection("systemRateLimits").doc(dayId);
  const allowed = await firestore().runTransaction(async (transaction) => {
    const [minute, day] = await transaction.getAll(minuteRef, dayRef);
    if (!minute || !day) throw new Error("Shared rate-limit state could not be read.");
    const minuteCount = Number(minute.data()?.["count"] ?? 0);
    const dayCount = Number(day.data()?.["count"] ?? 0);
    if (
      !Number.isSafeInteger(minuteCount) ||
      !Number.isSafeInteger(dayCount) ||
      minuteCount < 0 ||
      dayCount < 0
    ) {
      throw new Error("Shared rate-limit state is invalid.");
    }
    if (minuteCount >= perMinuteLimit || dayCount >= perDayLimit) return false;
    transaction.set(minuteRef, { count: minuteCount + 1, expires_at: new Date(now + 2 * 60_000) });
    transaction.set(dayRef, { count: dayCount + 1, expires_at: new Date(now + 2 * 86_400_000) });
    return true;
  });
  if (!allowed) throw new Error("Too many requests right now. Wait a moment and retry.");
}
