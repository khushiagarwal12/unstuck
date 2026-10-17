import { publicCourseSchema } from "./tutor-schemas";
import type { SigningConfig } from "./answer-key.server";

/**
 * The server signs every generated course plan so a learner cannot edit their own phases, prerequisites or
 * lessons before saving. Assignment questions are already sealed separately inside each phase's answer token.
 */
const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const fromBase64Url = (value: string) => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)), (c) =>
    c.charCodeAt(0),
  );
};

const hmacKey = (secret: string, usage: "sign" | "verify") =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(`course-plan:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );

/** Schema-parsed JSON has a stable key order, so the signer and the verifier see identical bytes. */
export const canonicalPlan = (plan: unknown) => JSON.stringify(publicCourseSchema.parse(plan));

export async function signCoursePlan(plan: unknown, config: SigningConfig): Promise<string> {
  const secret = config.keys[config.activeKeyId];
  if (!secret) throw new Error("Answer verification is not configured. Please try again later.");
  const mac = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret, "sign"),
    encoder.encode(canonicalPlan(plan)),
  );
  return `${config.activeKeyId}.${toBase64Url(new Uint8Array(mac))}`;
}

export async function verifyCoursePlan(
  plan: unknown,
  signature: string,
  config: SigningConfig,
): Promise<boolean> {
  const [keyId, mac, extra] = signature.split(".");
  const secret = keyId ? config.keys[keyId] : undefined;
  if (!secret || !mac || extra !== undefined) return false;
  try {
    return await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret, "verify"),
      fromBase64Url(mac) as BufferSource,
      encoder.encode(canonicalPlan(plan)),
    );
  } catch {
    return false;
  }
}
