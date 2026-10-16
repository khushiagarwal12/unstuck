import { afterEach, describe, expect, it, vi } from "vitest";

import { geminiGenerate, pickProvider } from "@/lib/ai-provider.server";

afterEach(() => vi.unstubAllGlobals());

const reply = (text: string, status = 200) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status });

describe("Gemini provider", () => {
  it("calls the Generative Language API with the key in a header, JSON mode, and the tier's model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    const gen = geminiGenerate("KEY", { GEMINI_MODEL_FAST: "fast-model" });
    const out = await gen({ system: "sys", prompt: "hi", tier: "fast", temperature: 0.1 });
    expect(out).toBe('{"ok":true}');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/fast-model:generateContent");
    expect(String(url)).not.toContain("KEY");
    expect(init.headers["x-goog-api-key"]).toBe("KEY");
    const body = JSON.parse(init.body);
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", temperature: 0.1 });
    expect(body.systemInstruction.parts[0].text).toBe("sys");
  });

  it("maps provider errors to learner-friendly messages without leaking details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret detail", { status: 429 })));
    await expect(geminiGenerate("K", {})({ system: "", prompt: "", tier: "main", temperature: 0 })).rejects.toThrow(/Too many requests/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret detail", { status: 403 })));
    await expect(geminiGenerate("K", {})({ system: "", prompt: "", tier: "main", temperature: 0 })).rejects.toThrow(/credentials/);
  });

  it("treats an empty candidate list as an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [] }))));
    await expect(geminiGenerate("K", {})({ system: "", prompt: "", tier: "main", temperature: 0 })).rejects.toThrow(/empty/);
  });
});

describe("pickProvider", () => {
  it("prefers Gemini, and refuses to run with no key", () => {
    expect(typeof pickProvider({ GEMINI_API_KEY: "k", LOVABLE_API_KEY: "l" })).toBe("function");
    expect(() => pickProvider({})).toThrow(/GEMINI_API_KEY/);
  });
});
