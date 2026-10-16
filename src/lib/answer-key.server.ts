export type AnswerKind = "diagnostic" | "transfer";
type TutorQuestion = Record<string, unknown> & { correctIndex: number };

type AnswerKey = {
  kind: AnswerKind | "course-assessment";
  correctIndex: number;
  explanation?: string;
  expiresAt: number;
  nonce: string;
};

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const COURSE_TOKEN_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const submissions = new Map<string, { choice: number; result: { correct: boolean; explanation?: string }; expiresAt: number }>();

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey(
    "raw",
    material,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

function configuredSecret(secret: string | undefined): string {
  if (!secret || secret.length < 32) {
    throw new Error("Answer verification is not configured. Please try again later.");
  }
  return secret;
}

export async function issueAnswerKey(
  key: Omit<AnswerKey, "expiresAt" | "nonce">,
  secret: string | undefined,
  now = Date.now(),
): Promise<string> {
  const nonce = encodeBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const plaintext = new TextEncoder().encode(JSON.stringify({ ...key, expiresAt: now + TOKEN_TTL_MS, nonce }));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(configuredSecret(secret)),
    plaintext,
  );
  return `${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(encrypted))}`;
}

export async function sealCourseAssessment(
  payload: Record<string, unknown>,
  secret: string | undefined,
  now = Date.now(),
): Promise<string> {
  const nonce = encodeBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const plaintext = new TextEncoder().encode(JSON.stringify({
    kind: "course-assessment",
    payload,
    expiresAt: now + COURSE_TOKEN_TTL_MS,
    nonce,
  }));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(configuredSecret(secret)),
    plaintext,
  );
  return `${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(encrypted))}`;
}

export async function openCourseAssessment(
  token: string,
  secret: string | undefined,
  now = Date.now(),
): Promise<Record<string, unknown>> {
  const key = configuredSecret(secret);
  const [suppliedIv, ciphertext, extra] = token.split(".");
  if (!suppliedIv || !ciphertext || extra !== undefined) throw new Error("This assignment has expired. Please generate it again.");
  let iv: Uint8Array;
  let encrypted: Uint8Array;
  try {
    iv = decodeBase64Url(suppliedIv);
    encrypted = decodeBase64Url(ciphertext);
  } catch {
    throw new Error("This assignment could not be verified. Please try again.");
  }
  if (iv.length !== 12) throw new Error("This assignment could not be verified. Please try again.");
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await encryptionKey(key), encrypted);
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as {
      kind?: unknown;
      payload?: unknown;
      expiresAt?: unknown;
      nonce?: unknown;
    };
    if (parsed.kind !== "course-assessment" || typeof parsed.expiresAt !== "number" || parsed.expiresAt < now ||
      typeof parsed.nonce !== "string" || parsed.payload === null || typeof parsed.payload !== "object") {
      throw new Error("This assignment has expired. Please generate it again.");
    }
    return parsed.payload as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message.includes("expired")) throw error;
    throw new Error("This assignment could not be verified. Please try again.");
  }
}

export async function protectTutorQuestion(
  json: string,
  kind: AnswerKind,
  secret: string | undefined,
): Promise<string> {
  const question = JSON.parse(json) as TutorQuestion;
  const answerToken = await issueAnswerKey(
    {
      kind,
      correctIndex: question.correctIndex,
      ...(typeof question.explanation === "string" ? { explanation: question.explanation } : {}),
    },
    secret,
  );
  delete question.correctIndex;
  if (kind === "diagnostic" && Array.isArray(question.options)) {
    question.options = question.options.map((option) => {
      if (typeof option !== "object" || option === null || !("text" in option)) return option;
      return { text: option.text };
    });
  }
  if (kind === "transfer") delete question.explanation;
  return JSON.stringify({ ...question, answerToken });
}

export async function checkAnswerKey(
  token: string,
  kind: AnswerKind,
  choice: number,
  secret: string | undefined,
  now = Date.now(),
): Promise<{ correct: boolean; explanation?: string }> {
  const key = configuredSecret(secret);
  const [suppliedIv, ciphertext, extra] = token.split(".");
  if (!suppliedIv || !ciphertext || extra !== undefined) throw new Error("This question has expired. Please try again.");
  let iv: Uint8Array;
  let encrypted: Uint8Array;
  try {
    iv = decodeBase64Url(suppliedIv);
    encrypted = decodeBase64Url(ciphertext);
  } catch {
    throw new Error("This question could not be verified. Please try again.");
  }
  if (iv.length !== 12) {
    throw new Error("This question could not be verified. Please try again.");
  }

  let parsed: AnswerKey;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      await encryptionKey(key),
      encrypted,
    );
    parsed = JSON.parse(new TextDecoder().decode(plaintext)) as AnswerKey;
  } catch {
    throw new Error("This question could not be verified. Please try again.");
  }
  if (
    parsed.kind !== kind ||
    !Number.isInteger(parsed.correctIndex) ||
    parsed.correctIndex < 0 ||
    parsed.correctIndex > 3 ||
    !Number.isFinite(parsed.expiresAt) ||
    parsed.expiresAt < now ||
    typeof parsed.nonce !== "string"
  ) {
    throw new Error("This question has expired. Please try again.");
  }

  const prior = submissions.get(token);
  if (prior && prior.expiresAt >= now) {
    if (prior.choice !== choice) throw new Error("This question has already been answered. Please continue to the next step.");
    return prior.result;
  }

  const result = { correct: choice === parsed.correctIndex, ...(parsed.explanation ? { explanation: parsed.explanation } : {}) };
  submissions.set(token, { choice, result, expiresAt: parsed.expiresAt });
  if (submissions.size > 5000) {
    for (const [usedToken, submission] of submissions) if (submission.expiresAt < now) submissions.delete(usedToken);
  }
  return result;
}
