import { createHash } from "node:crypto";

import { firestore } from "@/integrations/firebase/admin.server";
import type { AnswerReplayStore, AnswerResult } from "./answer-key.server";

export const firestoreAnswerReplayStore: AnswerReplayStore = {
  async consume({ token, choice, result, expiresAt }) {
    const id = createHash("sha256").update(token).digest("hex");
    const ref = firestore().collection("answerTokenReplays").doc(id);
    return firestore().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (snapshot.exists) {
        const saved = snapshot.data();
        if (saved?.["choice"] !== choice) {
          throw new Error(
            "This question has already been answered. Please continue to the next step.",
          );
        }
        return saved?.["result"] as AnswerResult;
      }
      transaction.create(ref, {
        choice,
        result,
        expires_at: new Date(expiresAt),
      });
      return result;
    });
  },
};
