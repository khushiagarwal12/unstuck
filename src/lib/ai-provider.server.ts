import { accessToken, type Env } from "./google-auth.server";
import type { Generate } from "./tutor-core";

const TIMEOUT_MS = 45_000;

export class ProviderError extends Error {}

function friendly(status: number): ProviderError {
  if (status === 429) return new ProviderError("Too many requests right now. Wait a moment and retry.");
  if (status === 402) return new ProviderError("AI credits are exhausted for this workspace.");
  if (status === 401 || status === 403) return new ProviderError("The AI service rejected our credentials.");
  return new ProviderError(`The AI service is unavailable right now (${status}). Try again.`);
}

/** Google Gemini through the Generative Language API (Google AI Studio key). */
function requestBody({ system, prompt, temperature, image }: Parameters<Generate>[0]) {
  const parts: object[] = [{ text: prompt }];
  if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json", temperature },
  };
}

function readText(data: { candidates?: { content?: { parts?: { text?: string }[] } }[] }): string {
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new ProviderError("The AI returned an empty answer. Try again.");
  return text;
}

export function geminiGenerate(apiKey: string, env: Record<string, string | undefined>): Generate {
  const models = {
    main: env["GEMINI_MODEL_MAIN"] || "gemini-2.5-flash",
    fast: env["GEMINI_MODEL_FAST"] || "gemini-2.5-flash-lite",
  };
  return async (req) => {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${models[req.tier]}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify(requestBody(req)),
    });
    if (!res.ok) throw friendly(res.status);
    return readText((await res.json()) as Parameters<typeof readText>[0]);
  };
}

/** Gemini on Google Cloud Vertex AI. Bills the Google Cloud project, so trial credits apply. */
export function vertexGenerate(env: Env, token: () => Promise<string> = () => accessToken(env)): Generate {
  const project = env["GOOGLE_CLOUD_PROJECT"];
  if (!project) throw new ProviderError("Vertex AI needs GOOGLE_CLOUD_PROJECT.");
  const location = env["GOOGLE_CLOUD_LOCATION"] || "us-central1";
  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  const models = {
    main: env["GEMINI_MODEL_MAIN"] || "gemini-2.5-flash",
    fast: env["GEMINI_MODEL_FAST"] || "gemini-2.5-flash-lite",
  };
  return async (req) => {
    let bearer: string;
    try {
      bearer = await token();
    } catch {
      throw new ProviderError("The AI service rejected our credentials.");
    }
    const url = `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${models[req.tier]}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify(requestBody(req)),
    });
    if (!res.ok) throw friendly(res.status);
    return readText((await res.json()) as Parameters<typeof readText>[0]);
  };
}

/** Lovable AI gateway, used only when no Gemini key is configured. */
export function lovableGenerate(key: string): Generate {
  return async ({ system, prompt, image }) => {
    if (image) throw new ProviderError("Reading photos needs Google Gemini. Add GEMINI_API_KEY in the project secrets.");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${key}`,
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "fetch",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        instructions: system,
        input: [{ role: "user", content: prompt }],
        reasoning: { effort: "low" },
        store: false,
        stream: true,
        text: {
          format: {
            type: "json_schema",
            name: "tutor_reply",
            strict: true,
            schema: {
              type: "object",
              properties: { json: { type: "string", description: "The requested JSON object, serialized" } },
              required: ["json"],
              additionalProperties: false,
            },
          },
        },
      }),
    });
    if (!res.ok || !res.body) throw friendly(res.status);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const d = line.slice(5).trim();
        if (!d || d === "[DONE]") continue;
        let ev: { type?: string; delta?: string };
        try {
          ev = JSON.parse(d);
        } catch {
          continue;
        }
        if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
        if (ev.type === "error" || ev.type === "response.failed") throw new ProviderError("AI generation failed. Try again.");
      }
    }
    return (JSON.parse(text) as { json: string }).json;
  };
}

/** Vertex AI when LLM_BACKEND=vertex, else a Gemini API key, else the Lovable gateway as a last resort. */
export function pickProvider(env: Env): Generate {
  if (env["LLM_BACKEND"] === "vertex") return vertexGenerate(env);
  const gemini = env["GEMINI_API_KEY"];
  if (gemini) return geminiGenerate(gemini, env);
  const lovable = env["LOVABLE_API_KEY"];
  if (lovable) return lovableGenerate(lovable);
  throw new ProviderError("AI is not configured. Add GEMINI_API_KEY in the project secrets.");
}

/** True when the configured provider can read images (Gemini or Vertex AI). */
export function supportsVision(env: Env): boolean {
  return env["LLM_BACKEND"] === "vertex" || !!env["GEMINI_API_KEY"];
}
