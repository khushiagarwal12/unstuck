import { generateKeyPairSync, verify } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { pickProvider, supportsVision, vertexGenerate, geminiGenerate } from "@/lib/ai-provider.server";
import { findVideo, synthesizeSpeech, translateTexts, videoAvailable } from "@/lib/google-apis.server";
import { accessToken, clearTokenCache, signJwt } from "@/lib/google-auth.server";

afterEach(() => { vi.unstubAllGlobals(); clearTokenCache(); });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const REQ = { system: "s", prompt: "p", tier: "main", temperature: 0 } as const;

function serviceAccount() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return { pem, publicKey, sa: { client_email: "svc@proj.iam.gserviceaccount.com", private_key: pem } };
}

describe("service account auth", () => {
  it("signs a valid RS256 JWT with the right claims", async () => {
    const { publicKey, sa } = serviceAccount();
    const jwt = await signJwt(sa, 1_000);
    const [h, c, sig] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claims).toMatchObject({ iss: sa.client_email, aud: "https://oauth2.googleapis.com/token", iat: 1000, exp: 4600 });
    expect(claims.scope).toContain("cloud-platform");
    expect(verify("RSA-SHA256", Buffer.from(`${h}.${c}`), publicKey, Buffer.from(sig, "base64url"))).toBe(true);
  });

  it("exchanges the JWT for a token once and caches it", async () => {
    const { sa } = serviceAccount();
    const f = vi.fn().mockResolvedValue(json({ access_token: "tok", expires_in: 3600 }));
    vi.stubGlobal("fetch", f);
    const env = { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(sa) };
    expect(await accessToken(env, () => 0)).toBe("tok");
    expect(await accessToken(env, () => 1000)).toBe("tok");
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0]![1].body)).toContain("jwt-bearer");
  });

  it("prefers an explicit access token, and fails clearly with no credentials", async () => {
    expect(await accessToken({ GOOGLE_ACCESS_TOKEN: "dev" })).toBe("dev");
    await expect(accessToken({})).rejects.toThrow(/not configured/);
  });
});

describe("Vertex AI provider", () => {
  it("calls the regional endpoint with a bearer token and no API key in the URL", async () => {
    const f = vi.fn().mockResolvedValue(json({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }));
    vi.stubGlobal("fetch", f);
    const gen = vertexGenerate({ GOOGLE_CLOUD_PROJECT: "unstuck", GOOGLE_CLOUD_LOCATION: "us-central1", GEMINI_MODEL_FAST: "fm" }, async () => "BEARER");
    await gen({ ...REQ, tier: "fast", image: { mimeType: "image/png", data: "QUJD" } });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://us-central1-aiplatform.googleapis.com/v1/projects/unstuck/locations/us-central1/publishers/google/models/fm:generateContent");
    expect(init.headers.Authorization).toBe("Bearer BEARER");
    expect(JSON.parse(init.body).contents[0].parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: "QUJD" } });
  });

  it("needs a project, and hides credential problems behind a friendly message", async () => {
    expect(() => vertexGenerate({})).toThrow(/GOOGLE_CLOUD_PROJECT/);
    const gen = vertexGenerate({ GOOGLE_CLOUD_PROJECT: "p" }, async () => { throw new Error("secret"); });
    await expect(gen(REQ)).rejects.toThrow(/credentials/);
  });

  it("is chosen by LLM_BACKEND=vertex, and Gemini sends images as inline data", async () => {
    expect(typeof pickProvider({ LLM_BACKEND: "vertex", GOOGLE_CLOUD_PROJECT: "p" })).toBe("function");
    expect(supportsVision({ LLM_BACKEND: "vertex" })).toBe(true);
    expect(supportsVision({ LOVABLE_API_KEY: "x" })).toBe(false);
    const f = vi.fn().mockResolvedValue(json({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }));
    vi.stubGlobal("fetch", f);
    await geminiGenerate("K", {})({ ...REQ, image: { mimeType: "image/jpeg", data: "QUJD" } });
    expect(JSON.parse(f.mock.calls[0]![1].body).contents[0].parts).toHaveLength(2);
  });
});

describe("Google Cloud APIs", () => {
  it("Text-to-Speech sends the language and returns the audio", async () => {
    const f = vi.fn().mockResolvedValue(json({ audioContent: "AUDIO" }));
    vi.stubGlobal("fetch", f);
    expect(await synthesizeSpeech({ GOOGLE_API_KEY: "K" }, "hello", "hi-IN")).toBe("AUDIO");
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://texttospeech.googleapis.com/v1/text:synthesize");
    expect(init.headers["x-goog-api-key"]).toBe("K");
    expect(JSON.parse(init.body)).toMatchObject({ input: { text: "hello" }, voice: { languageCode: "hi-IN" }, audioConfig: { audioEncoding: "MP3" } });
  });

  it("Translation keeps order and rejects an incomplete answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: { translations: [{ translatedText: "एक" }, { translatedText: "दो" }] } })));
    expect(await translateTexts({ GOOGLE_API_KEY: "K" }, ["one", "two"], "hi")).toEqual(["एक", "दो"]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: { translations: [{ translatedText: "x" }] } })));
    await expect(translateTexts({ GOOGLE_API_KEY: "K" }, ["a", "b"], "hi")).rejects.toThrow(/incomplete/);
  });

  it("YouTube search asks for safe, embeddable videos and handles no results", async () => {
    const f = vi.fn().mockResolvedValue(json({ items: [{ id: { videoId: "abc" }, snippet: { title: "T", channelTitle: "C" } }] }));
    vi.stubGlobal("fetch", f);
    expect(await findVideo({ GOOGLE_API_KEY: "K" }, "fractions", "en")).toEqual({ id: "abc", title: "T", channel: "C" });
    const url = new URL(String(f.mock.calls[0]![0]));
    expect(url.searchParams.get("safeSearch")).toBe("strict");
    expect(url.searchParams.get("videoEmbeddable")).toBe("true");
    expect(String(f.mock.calls[0]![0])).not.toContain("key=");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ items: [] })));
    expect(await findVideo({ GOOGLE_API_KEY: "K" }, "zzz", "en")).toBeNull();
    expect(videoAvailable({})).toBe(false);
  });

  it("maps a disabled API to a message that says what to enable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("detail", { status: 403 })));
    await expect(synthesizeSpeech({ GOOGLE_API_KEY: "K" }, "x", "en-IN")).rejects.toThrow(/isn't enabled/);
  });
});
