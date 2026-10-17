export type AnswerKind = "diagnostic" | "transfer";
type TutorQuestion = Record<string, unknown> & { correctIndex: number };

type AnswerKey = {
  kind: AnswerKind | "course-assessment";
  correctIndex: number;
  explanation?: string;
  concept?: string;
  context?: string;
  expiresAt: number;
  nonce: string;
};

export type AnswerResult = { correct: boolean; explanation?: string; concept?: string; context?: string };
export type AnswerReplayStore = {
  consume(input: { token: string; choice: number; result: AnswerResult; expiresAt: number }): Promise<AnswerResult>;
};
export type SigningConfig = { activeKeyId: string; keys: Record<string, string> };
type SigningInput = string | SigningConfig | undefined;

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

export function signingConfigFromEnvironment(env: Record<string, string | undefined>): SigningConfig {
  const serialized = env["ANSWER_SIGNING_KEYS_JSON"];
  const activeKeyId = env["ANSWER_SIGNING_ACTIVE_KEY_ID"];
  if (!serialized || !activeKeyId) {
    const legacy = env["QUESTION_SIGNING_SECRET"];
    if (legacy && legacy.length >= 32) return { activeKeyId: "legacy", keys: { legacy } };
    throw new Error("Answer verification is not configured. Please try again later.");
  }
  let keys: unknown;
  try {
    keys = JSON.parse(serialized);
  } catch {
    throw new Error("Answer verification key configuration is invalid.");
  }
  if (typeof keys !== "object" || keys === null || Array.isArray(keys)) {
    throw new Error("Answer verification key configuration is invalid.");
  }
  const validEntries = Object.entries(keys).filter(([keyId, value]) =>
    /^[a-zA-Z0-9_-]{1,40}$/.test(keyId) && typeof value === "string" && value.length >= 32);
  if (validEntries.length !== Object.keys(keys).length || !Object.hasOwn(keys, activeKeyId)) {
    throw new Error("Answer verification key configuration is invalid.");
  }
  return { activeKeyId, keys: Object.fromEntries(validEntries) as Record<string, string> };
}

function configuredKeys(input: SigningInput): SigningConfig {
  const config = typeof input === "object" && input !== null
    ? input
    : typeof input === "string" && input.length >= 32
      ? { activeKeyId: "legacy", keys: { legacy: input } }
      : undefined;
  if (!config || !/^[a-zA-Z0-9_-]{1,40}$/.test(config.activeKeyId) ||
    !config.keys[config.activeKeyId] || Object.values(config.keys).some((key) => key.length < 32)) {
    throw new Error("Answer verification is not configured. Please try again later.");
  }
  return config;
}

function tokenParts(token: string, config: SigningConfig) {
  const parts = token.split(".");
  if (parts.length === 2) return { keyId: "legacy", iv: parts[0], ciphertext: parts[1] };
  if (parts.length === 3) return { keyId: parts[0]!, iv: parts[1], ciphertext: parts[2] };
  throw new Error("This question could not be verified. Please try again.");
}

async function decryptToken(token: string, input: SigningInput) {
  const config = configuredKeys(input);
  const { keyId, iv: encodedIv, ciphertext: encodedCiphertext } = tokenParts(token, config);
  const secret = config.keys[keyId];
  if (!secret || !encodedIv || !encodedCiphertext) throw new Error("This question could not be verified. Please try again.");
  let iv: Uint8Array;
  let encrypted: Uint8Array;
  try {
    iv = decodeBase64Url(encodedIv);
    encrypted = decodeBase64Url(encodedCiphertext);
  } catch {
    throw new Error("This question could not be verified. Please try again.");
  }
  if (iv.length !== 12) throw new Error("This question could not be verified. Please try again.");
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await encryptionKey(secret), encrypted);
    return { keyId, parsed: JSON.parse(new TextDecoder().decode(plaintext)) as AnswerKey & { payload?: unknown } };
  } catch {
    throw new Error("This question could not be verified. Please try again.");
  }
}

export async function issueAnswerKey(
  key: Omit<AnswerKey, "expiresAt" | "nonce">,
  secret: SigningInput,
  now = Date.now(),
): Promise<string> {
  const config = configuredKeys(secret);
  const nonce = encodeBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const plaintext = new TextEncoder().encode(JSON.stringify({ ...key, expiresAt: now + TOKEN_TTL_MS, nonce }));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(config.keys[config.activeKeyId]!),
    plaintext,
  );
  return `${config.activeKeyId}.${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(encrypted))}`;
}

export async function sealCourseAssessment(
  payload: Record<string, unknown>,
  secret: SigningInput,
  now = Date.now(),
): Promise<string> {
  const config = configuredKeys(secret);
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
    await encryptionKey(config.keys[config.activeKeyId]!),
    plaintext,
  );
  return `${config.activeKeyId}.${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(encrypted))}`;
}

export async function openCourseAssessment(
  token: string,
  secret: SigningInput,
  now = Date.now(),
): Promise<Record<string, unknown>> {
  configuredKeys(secret);
  const { parsed } = await decryptToken(token, secret) as { parsed: AnswerKey & { payload?: unknown } };
  try {
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
  secret: SigningInput,
  concept?: string,
): Promise<string> {
  const question = JSON.parse(json) as TutorQuestion;
  const answerToken = await issueAnswerKey(
    {
      kind,
      correctIndex: question.correctIndex,
      ...(typeof question["explanation"] === "string" ? { explanation: question["explanation"] } : {}),
      ...(concept ? { concept } : {}),
      ...(typeof question["context"] === "string" ? { context: question["context"] } : {}),
    },
    secret,
  );
  delete question.correctIndex;
  if (kind === "diagnostic" && Array.isArray(question["options"])) {
    question["options"] = question["options"].map((option) => {
      if (typeof option !== "object" || option === null || !("text" in option)) return option;
      return { text: option.text };
    });
  }
  if (kind === "transfer") delete question["explanation"];
  return JSON.stringify({ ...question, answerToken });
}

export async function checkAnswerKey(
  token: string,
  kind: AnswerKind,
  choice: number,
  secret: SigningInput,
  now = Date.now(),
  replayStore?: AnswerReplayStore,
): Promise<AnswerResult> {
  const { parsed } = await decryptToken(token, secret);
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

  const result = {
    correct: choice === parsed.correctIndex,
    ...(parsed.explanation ? { explanation: parsed.explanation } : {}),
    ...(parsed.concept ? { concept: parsed.concept } : {}),
    ...(parsed.context ? { context: parsed.context } : {}),
  };
  if (replayStore) {
    const stored = await replayStore.consume({ token, choice, result, expiresAt: parsed.expiresAt });
    return {
      correct: stored.correct,
      ...(stored.explanation ? { explanation: stored.explanation } : {}),
      ...(stored.concept ? { concept: stored.concept } : {}),
      ...(stored.context ? { context: stored.context } : {}),
    };
  }
  submissions.set(token, { choice, result, expiresAt: parsed.expiresAt });
  if (submissions.size > 5000) {
    for (const [usedToken, submission] of submissions) if (submission.expiresAt < now) submissions.delete(usedToken);
  }
  return result;
}
