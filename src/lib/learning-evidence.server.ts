import { createHash } from "node:crypto";

import { firestore } from "@/integrations/firebase/admin.server";
import type { AnswerKind, AnswerResult } from "./answer-key.server";
import { learnerDocument } from "./firestore-ownership.server";

function conceptDocId(concept: string) {
  return createHash("sha256").update(concept.trim().toLocaleLowerCase()).digest("hex");
}

export async function recordVerifiedAnswer(
  userId: string,
  answerToken: string,
  kind: AnswerKind,
  result: AnswerResult,
) {
  if (!result.concept) return;
  const user = learnerDocument(firestore(), userId);
  const attemptId = createHash("sha256").update(answerToken).digest("hex");
  const attemptRef = user.collection("verifiedLearningAttempts").doc(attemptId);
  const conceptRef = user.collection("concepts").doc(conceptDocId(result.concept));
  const now = new Date().toISOString();
  await firestore().runTransaction(async (transaction) => {
    const [attemptSnapshot, conceptSnapshot] = await Promise.all([
      transaction.get(attemptRef),
      transaction.get(conceptRef),
    ]);
    if (attemptSnapshot.exists) return;
    const previous = conceptSnapshot.data() ?? {};
    const previousTransferResults = Array.isArray(previous["recent_transfer_evidence"])
      ? previous["recent_transfer_evidence"] as { correct: boolean; context: string; clean: boolean }[]
      : [];
    const context = kind === "transfer" ? result.context ?? "unknown-context" : "diagnostic";
    const clean = kind === "transfer" && !previous["hint_since_attempt"];
    const recentTransferResults = kind === "transfer"
      ? [{ correct: result.correct, context, clean }, ...previousTransferResults].slice(0, 2)
      : previousTransferResults;
    const demonstrated = recentTransferResults.length === 2 &&
      recentTransferResults.every((item) => item.correct && item.clean) &&
      recentTransferResults[0]!.context !== recentTransferResults[1]!.context;
    const status = demonstrated
      ? "Demonstrated under current criteria"
      : kind === "transfer" && result.correct
        ? "Progressing"
        : kind === "transfer"
          ? "Needs more practice"
          : previous["status"] ?? "Not assessed";
    const cleanSuccesses = Number(previous["clean_successes"] ?? 0) + (clean && result.correct ? 1 : 0);
    const reviewIntervalDays = clean && result.correct
      ? Math.min(Number(previous["review_interval_days"] ?? 1) * 2, 30)
      : 1;
    const updated = {
      concept: result.concept,
      status,
      misconceptions: Array.isArray(previous["misconceptions"]) ? previous["misconceptions"] : [],
      styles: Array.isArray(previous["styles"]) ? previous["styles"] : [],
      hints_used: Number(previous["hints_used"] ?? 0),
      attempts: Number(previous["attempts"] ?? 0) + 1,
      clean_successes: cleanSuccesses,
      review_interval_days: reviewIntervalDays,
      review_at: new Date(Date.now() + reviewIntervalDays * 86_400_000).toISOString(),
      last_explanation: typeof previous["last_explanation"] === "string" ? previous["last_explanation"] : null,
      updated_at: now,
      recent_transfer_evidence: recentTransferResults,
      hint_since_attempt: false,
    };
    transaction.create(attemptRef, {
      concept: result.concept,
      kind,
      correct: result.correct,
      context,
      clean,
      created_at: now,
    });
    transaction.set(conceptRef, updated, { merge: true });
  });
}

export async function recordLearningHint(userId: string, concept: string) {
  const ref = learnerDocument(firestore(), userId).collection("concepts").doc(conceptDocId(concept));
  const now = new Date().toISOString();
  await firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.data() ?? {};
    transaction.set(ref, {
      concept,
      status: current["status"] ?? "Not assessed",
      attempts: current["attempts"] ?? 0,
      clean_successes: current["clean_successes"] ?? 0,
      hints_used: Number(current["hints_used"] ?? 0) + 1,
      hint_since_attempt: true,
      updated_at: now,
    }, { merge: true });
  });
}
