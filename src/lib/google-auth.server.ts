/**
 * Google OAuth for server-to-server calls (Vertex AI, Cloud APIs) using a service account.
 * Uses only Web Crypto and fetch, so it runs on Node, Cloud Run and edge workers alike.
 */
export type Env = Record<string, string | undefined>;

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const cache = new Map<string, { token: string; expiresAt: number }>();

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

const b64url = (input: ArrayBuffer | string): string => {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

export function readServiceAccount(env: Env): ServiceAccount | null {
  const raw = env["GOOGLE_SERVICE_ACCOUNT_JSON"];
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    return sa.client_email && sa.private_key ? sa : null;
  } catch {
    return null;
  }
}

export async function signJwt(sa: ServiceAccount, nowSeconds: number): Promise<string> {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(sig)}`;
}

/** A bearer token for Google Cloud APIs: GOOGLE_ACCESS_TOKEN (local dev) or a service account. */
export async function accessToken(env: Env, now: () => number = Date.now): Promise<string> {
  const direct = env["GOOGLE_ACCESS_TOKEN"];
  if (direct) return direct;
  const sa = readServiceAccount(env);
  if (!sa) throw new Error("Google Cloud credentials are not configured.");

  const hit = cache.get(sa.client_email);
  if (hit && hit.expiresAt - 60_000 > now()) return hit.token;

  const assertion = await signJwt(sa, Math.floor(now() / 1000));
  const res = await fetch(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new Error("Google rejected the service account credentials.");
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google returned no access token.");
  cache.set(sa.client_email, { token: data.access_token, expiresAt: now() + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}

export function clearTokenCache() {
  cache.clear();
}
