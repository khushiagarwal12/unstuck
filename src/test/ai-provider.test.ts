import { afterEach, describe, expect, it, vi } from "vitest";

import { pickProvider, vertexGenerate } from "@/lib/ai-provider.server";

afterEach(() => vi.unstubAllGlobals());

const reply = (text: string, status = 200) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status });

describe("Vertex AI Gemini provider", () => {
  it("uses ADC bearer auth, the selected model, JSON mode and request content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    const gen = vertexGenerate(
      {
        GOOGLE_CLOUD_PROJECT: "unstuck",
        GOOGLE_CLOUD_LOCATION: "us-central1",
        GEMINI_MODEL_FAST: "fast-model",
      },
      async () => "ADC_TOKEN",
    );
    const result = await gen({ system: "sys", prompt: "hi", tier: "fast", temperature: 0.1 });
    expect(result).toBe('{"ok":true}');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain(
      "/projects/unstuck/locations/us-central1/publishers/google/models/fast-model:generateContent",
    );
    expect(init.headers.Authorization).toBe("Bearer ADC_TOKEN");
    expect(url).not.toContain("ADC_TOKEN");
    const body = JSON.parse(init.body);
    expect(body.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      temperature: 0.1,
    });
    expect(body.systemInstruction.parts[0].text).toBe("sys");
  });

  it("maps service failures to safe learner-facing messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("private response", { status: 429 })),
    );
    await expect(
      vertexGenerate(
        { GOOGLE_CLOUD_PROJECT: "project" },
        async () => "token",
      )({
        system: "",
        prompt: "",
        tier: "main",
        temperature: 0,
      }),
    ).rejects.toThrow(/Too many requests/);
  });

  it("rejects empty model responses and missing project configuration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [] }))),
    );
    await expect(
      vertexGenerate(
        { GOOGLE_CLOUD_PROJECT: "project" },
        async () => "token",
      )({
        system: "",
        prompt: "",
        tier: "main",
        temperature: 0,
      }),
    ).rejects.toThrow(/empty/);
    expect(() => pickProvider({})).toThrow(/GOOGLE_CLOUD_PROJECT/);
  });
});
