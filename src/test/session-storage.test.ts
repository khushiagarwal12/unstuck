import { describe, expect, it } from "vitest";

import {
  adoptGuestSession,
  clearSession,
  readSession,
  shouldRestoreSession,
  writeSession,
  type SessionSnapshot,
} from "@/lib/session-storage";

const snapshot: SessionSnapshot = {
  stage: "diagnosis",
  topic: "Comparing fractions",
  notes: "",
  diag: {
    concept: "Fractions",
    question: "Which fraction is larger?",
    options: [{ text: "1/8" }, { text: "1/3" }, { text: "Equal" }, { text: "Cannot tell" }],
    answerToken: "signed-answer-key",
    why: "Checks fraction size.",
  },
  picked: 0,
  diagnosticCorrect: false,
  diagnosis: {
    demonstrated: [],
    hypotheses: [
      { label: "denominator", summary: "You may be comparing denominators.", confidence: "low" },
    ],
    unresolved: ["Whether the learner is comparing denominator size."],
    needsFollowUp: true,
    followUp: {
      question: "Can you picture each fraction?",
      options: ["A", "B"],
      why: "Separates the ideas.",
    },
    recommendedStyle: "visual",
  },
  followUps: [],
  disputed: [],
  lesson: null,
  styles: [],
  transfer: null,
  tPick: null,
  history: [],
};

describe("learning session storage", () => {
  it("restores an unfinished session after a reload and can clear it", () => {
    const key = "test-learning-session";
    writeSession(window.localStorage, key, snapshot);
    expect(readSession(window.localStorage, key)).toEqual(snapshot);
    clearSession(window.localStorage, key);
    expect(readSession(window.localStorage, key)).toBeNull();
  });

  it("rejects malformed saved state rather than trusting it", () => {
    const key = "test-learning-session-invalid";
    window.localStorage.setItem(key, JSON.stringify({ stage: "done", diag: { correctIndex: 1 } }));
    expect(() => readSession(window.localStorage, key)).toThrow();
    window.localStorage.removeItem(key);
  });

  it("starts a requested topic instead of restoring an idle or completed session", () => {
    expect(shouldRestoreSession({ ...snapshot, stage: "done" }, "New topic")).toBe(false);
    expect(shouldRestoreSession({ ...snapshot, stage: "start" }, "New topic")).toBe(false);
    expect(shouldRestoreSession(snapshot, "New topic")).toBe(true);
    expect(shouldRestoreSession({ ...snapshot, stage: "done" })).toBe(true);
  });

  it("adopts a guest session for the authenticated user without overwriting an existing session", () => {
    const guestKey = "unstuck.guest-session.v1";
    const userKey = "unstuck.user-session.v1:test-user";
    window.localStorage.removeItem(userKey);
    writeSession(window.localStorage, guestKey, snapshot);
    adoptGuestSession(window.localStorage, "test-user");
    expect(readSession(window.localStorage, userKey)).toEqual(snapshot);
    expect(readSession(window.localStorage, guestKey)).toBeNull();

    const otherGuestKey = "unstuck.guest-session.v1";
    writeSession(window.localStorage, otherGuestKey, { ...snapshot, topic: "Keep guest copy" });
    adoptGuestSession(window.localStorage, "test-user");
    expect(readSession(window.localStorage, otherGuestKey)?.topic).toBe("Keep guest copy");
    clearSession(window.localStorage, userKey);
    clearSession(window.localStorage, otherGuestKey);
  });
});
