import { GoogleAuth } from "google-auth-library";

export type Env = Record<string, string | undefined>;

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Uses ADC on Cloud Run and gcloud ADC locally; explicit tokens are only for local development. */
export async function accessToken(
  env: Env,
  now: () => number = Date.now,
  createAuth: (projectId?: string) => Pick<GoogleAuth, "getAccessToken"> = (projectId) =>
    new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE], ...(projectId ? { projectId } : {}) }),
): Promise<string> {
  const localToken = env["GOOGLE_ACCESS_TOKEN"];
  if (localToken) {
    if (env["K_SERVICE"])
      throw new Error("Static Google access tokens are not allowed in deployed services.");
    return localToken;
  }
  const projectId = env["GOOGLE_CLOUD_PROJECT"] || env["FIREBASE_PROJECT_ID"];
  const cacheKey = projectId ?? "default";
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - 60_000 > now()) return cached.token;

  try {
    const token = await createAuth(projectId).getAccessToken();
    if (!token) throw new Error("No access token.");
    tokenCache.set(cacheKey, { token, expiresAt: now() + 50 * 60_000 });
    return token;
  } catch {
    throw new Error("Google Cloud Application Default Credentials are unavailable.");
  }
}

export function clearTokenCache() {
  tokenCache.clear();
}
