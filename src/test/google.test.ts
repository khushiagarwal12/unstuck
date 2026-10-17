import { afterEach, describe, expect, it, vi } from "vitest";

import { pickProvider, supportsVision, vertexGenerate } from "@/lib/ai-provider.server";
import { findVideo, synthesizeSpeech, translateTexts, videoAvailable } from "@/lib/google-apis.server";
import { accessToken, clearTokenCache } from "@/lib/google-auth.server";

afterEach(() => { vi.unstubAllGlobals(); clearTokenCache(); });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const REQ = { system: "s", prompt: "p", tier: "main", temperature: 0 } as const;

describe("Google Application Default Credentials", () => {
  it("gets an ADC token once and reuses the cached token", async () => {
    const getAccessToken = vi.fn().mockResolvedValue("tok");
    const createAuth = vi.fn(() => ({ getAccessToken }));
    const env = { GOOGLE_CLOUD_PROJECT: "project-id" };
    expect(await accessToken(env, () => 0, createAuth)).toBe("tok");
    expect(await accessToken(env, () => 1000, createAuth)).toBe("tok");
    expect(createAuth).toHaveBeenCalledTimes(1);
    expect(createAuth).toHaveBeenCalledWith("project-id");
  });

  it("prefers an explicit access token, and fails clearly with no credentials", async () => {
    expect(await accessToken({ GOOGLE_ACCESS_TOKEN: "dev" })).toBe("dev");
    await expect(accessToken({ GOOGLE_ACCESS_TOKEN: "dev", K_SERVICE: "unstuck" }))
      .rejects.toThrow(/not allowed in deployed services/);
    await expect(accessToken({}, Date.now, () => ({ getAccessToken: async () => null })))
      .rejects.toThrow(/Application Default Credentials are unavailable/);
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

  it("always selects Vertex AI and exposes vision only when a project is configured", () => {
    expect(typeof pickProvider({ GOOGLE_CLOUD_PROJECT: "p" })).toBe("function");
    expect(supportsVision({ GOOGLE_CLOUD_PROJECT: "p" })).toBe(true);
    expect(supportsVision({})).toBe(false);
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
