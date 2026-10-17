import { describe, expect, it } from "vitest";

import {
  checkAnswerKey,
  issueAnswerKey,
  openCourseAssessment,
  protectTutorQuestion,
  sealCourseAssessment,
  signingConfigFromEnvironment,
} from "@/lib/answer-key.server";

const secret = "this-is-a-test-signing-secret-long-enough";

describe("server-held answer keys", () => {
  it("removes answer indices, misconception labels, and explanations from question responses", async () => {
    const diagnostic = JSON.parse(
      await protectTutorQuestion(
        JSON.stringify({
          concept: "Fractions",
          question: "Choose the larger fraction.",
          options: [
            { text: "1/8", misconception: "Compares denominators" },
            { text: "1/3", misconception: null },
            { text: "Equal", misconception: "Assumes equality" },
            { text: "Cannot tell", misconception: null },
          ],
          correctIndex: 1,
          why: "Checks fraction size.",
        }),
        "diagnostic",
        secret,
      ),
    ) as Record<string, unknown>;
    expect(diagnostic).not.toHaveProperty("correctIndex");
    expect(JSON.stringify(diagnostic)).not.toContain("misconception");
    expect(JSON.stringify(diagnostic)).not.toContain("correctIndex");
    expect(
      await checkAnswerKey(diagnostic["answerToken"] as string, "diagnostic", 1, secret),
    ).toEqual({ correct: true });

    const transfer = JSON.parse(
      await protectTutorQuestion(
        JSON.stringify({
          question: "A transfer check.",
          options: ["A", "B", "C", "D"],
          correctIndex: 1,
          explanation: "Why B is right.",
          context: "A new setting",
        }),
        "transfer",
        secret,
      ),
    ) as Record<string, unknown>;
    expect(transfer).not.toHaveProperty("correctIndex");
    expect(transfer).not.toHaveProperty("explanation");
    expect(await checkAnswerKey(transfer["answerToken"] as string, "transfer", 1, secret)).toEqual({
      correct: true,
      explanation: "Why B is right.",
      context: "A new setting",
    });
  });

  it("checks a submitted answer without returning the answer index", async () => {
    const correctToken = await issueAnswerKey(
      { kind: "diagnostic", correctIndex: 2 },
      secret,
      1000,
    );
    const wrongToken = await issueAnswerKey({ kind: "diagnostic", correctIndex: 2 }, secret, 1000);
    expect(correctToken).not.toContain("correctIndex");
    expect(await checkAnswerKey(correctToken, "diagnostic", 2, secret, 1001)).toEqual({
      correct: true,
    });
    expect(await checkAnswerKey(wrongToken, "diagnostic", 0, secret, 1001)).toEqual({
      correct: false,
    });
  });

  it("returns a transfer explanation only after answer submission", async () => {
    const token = await issueAnswerKey(
      { kind: "transfer", correctIndex: 1, explanation: "A short explanation." },
      secret,
    );
    expect((await checkAnswerKey(token, "transfer", 1, secret)).explanation).toBe(
      "A short explanation.",
    );
  });

  it("keeps course assignment answer keys encrypted and usable after the normal question-token expiry", async () => {
    const payload = {
      phaseId: "phase-one",
      correctIndex: 2,
      referenceCriteria: "Explain the invariant.",
    };
    const token = await sealCourseAssessment(payload, secret, 1000);
    expect(token).not.toContain("correctIndex");
    expect(
      await openCourseAssessment(token, secret, 1000 + 10 * 365 * 24 * 60 * 60 * 1000),
    ).toEqual(payload);
    await expect(
      openCourseAssessment(token, "a-different-signing-secret-that-is-long-enough", 1001),
    ).rejects.toThrow(/verified/);
  });

  it("rejects tampered, wrong-kind, expired, and unconfigured keys", async () => {
    const token = await issueAnswerKey({ kind: "diagnostic", correctIndex: 2 }, secret, 1000);
    const [keyId, iv, ciphertext] = token.split(".");
    const changedCiphertext = `${ciphertext![0] === "A" ? "B" : "A"}${ciphertext!.slice(1)}`;
    const tampered = `${keyId}.${iv}.${changedCiphertext}`;
    await expect(checkAnswerKey(tampered, "diagnostic", 2, secret, 1001)).rejects.toThrow(
      /verified/,
    );
    await expect(checkAnswerKey(token, "transfer", 2, secret, 1001)).rejects.toThrow(/expired/);
    await expect(
      checkAnswerKey(token, "diagnostic", 2, secret, 1000 + 24 * 60 * 60 * 1000 + 1),
    ).rejects.toThrow(/expired/);
    await expect(
      issueAnswerKey({ kind: "diagnostic", correctIndex: 0 }, undefined),
    ).rejects.toThrow(/not configured/);
  });

  it("does not allow an answer token to be used as a repeated answer oracle", async () => {
    const token = await issueAnswerKey({ kind: "diagnostic", correctIndex: 1 }, secret);
    expect(await checkAnswerKey(token, "diagnostic", 0, secret)).toEqual({ correct: false });
    expect(await checkAnswerKey(token, "diagnostic", 0, secret)).toEqual({ correct: false });
    await expect(checkAnswerKey(token, "diagnostic", 1, secret)).rejects.toThrow(
      /already been answered/,
    );
  });

  it("decrypts outstanding tokens with retained keys after active-key rotation", async () => {
    const oldKey = "previous-key-material-at-least-32-characters";
    const newKey = "current-key-material-at-least-32-characters";
    const oldConfig = { activeKeyId: "old", keys: { old: oldKey } };
    const rotatedConfig = { activeKeyId: "new", keys: { new: newKey, old: oldKey } };
    const token = await issueAnswerKey({ kind: "diagnostic", correctIndex: 3 }, oldConfig, 1000);
    const result = await checkAnswerKey(token, "diagnostic", 3, rotatedConfig, 1001);
    expect(result.correct).toBe(true);
  });

  it("loads a valid active key ring and fails closed on invalid configuration", () => {
    expect(
      signingConfigFromEnvironment({
        ANSWER_SIGNING_ACTIVE_KEY_ID: "active",
        ANSWER_SIGNING_KEYS_JSON: JSON.stringify({ active: secret }),
      }),
    ).toEqual({ activeKeyId: "active", keys: { active: secret } });
    expect(() =>
      signingConfigFromEnvironment({
        ANSWER_SIGNING_ACTIVE_KEY_ID: "missing",
        ANSWER_SIGNING_KEYS_JSON: JSON.stringify({ active: secret }),
      }),
    ).toThrow(/invalid/);
    expect(() =>
      signingConfigFromEnvironment({
        ANSWER_SIGNING_ACTIVE_KEY_ID: "active",
        ANSWER_SIGNING_KEYS_JSON: "{",
      }),
    ).toThrow(/invalid/);
  });
});
