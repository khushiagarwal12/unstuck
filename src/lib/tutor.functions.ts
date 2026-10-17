import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { pickProvider } from "./ai-provider.server";
import { checkAnswerKey, protectTutorQuestion } from "./answer-key.server";
import { protectCoursePlan } from "./course-assessment.server";
import { enforceLimits } from "./limits.server";
import { enforceSharedLimits } from "./shared-limits.server";
import { runTutor } from "./tutor-core";
import { ACTIONS } from "./tutor-schemas";
import { signingConfigFromEnvironment } from "./answer-key.server";
import { firestoreAnswerReplayStore } from "./answer-replay.server";
import { optionalFirebaseUserId } from "@/integrations/firebase/auth-middleware";
import { recordVerifiedAnswer } from "./learning-evidence.server";

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
    const userId = await optionalFirebaseUserId();
    await enforceSharedLimits(userId ?? undefined);
    enforceLimits();
    const signingConfig = signingConfigFromEnvironment(process.env);
    const json = await runTutor(pickProvider(process.env), data.action, data.payload);
    if (data.action === "course") {
      return { json: await protectCoursePlan(json, signingConfig) };
    }
    if (data.action !== "start" && data.action !== "transfer") return { json };
    return {
      json: await protectTutorQuestion(
        json,
        data.action === "start" ? "diagnostic" : "transfer",
        signingConfig,
        typeof data.payload["concept"] === "string" ? data.payload["concept"] : undefined,
      ),
    };
  });

const answerInput = z.object({
  kind: z.enum(["diagnostic", "transfer"]),
  answerToken: z.string().min(1).max(4096),
  choice: z.number().int().min(0).max(3),
});

export const checkTutorAnswer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => answerInput.parse(d))
  .handler(async ({ data }) => {
    const userId = await optionalFirebaseUserId();
    await enforceSharedLimits(userId ?? undefined);
    enforceLimits();
    const result = await checkAnswerKey(
      data.answerToken,
      data.kind,
      data.choice,
      signingConfigFromEnvironment(process.env),
      Date.now(),
      firestoreAnswerReplayStore,
    );
    if (userId) await recordVerifiedAnswer(userId, data.answerToken, data.kind, result);
    return result;
  });
