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
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  if (!text) throw new ProviderError("The AI returned an empty answer. Try again.");
  return text;
}

/** Gemini on Vertex AI, authenticated with the runtime's Application Default Credentials. */
export function vertexGenerate(env: Env, token: () => Promise<string> = () => accessToken(env)): Generate {
  const project = env["GOOGLE_CLOUD_PROJECT"] || env["FIREBASE_PROJECT_ID"];
  if (!project) throw new ProviderError("Vertex AI needs GOOGLE_CLOUD_PROJECT.");
  const location = env["GOOGLE_CLOUD_LOCATION"] || "us-central1";
  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  const models = {
    main: env["GEMINI_MODEL_MAIN"] || "gemini-2.5-flash",
    fast: env["GEMINI_MODEL_FAST"] || "gemini-2.5-flash-lite",
  };
  return async (request) => {
    let bearer: string;
    try {
      bearer = await token();
    } catch {
      throw new ProviderError("The AI service rejected our credentials.");
    }
    const url = `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${models[request.tier]}:generateContent`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify(requestBody(request)),
    });
    if (!response.ok) throw friendly(response.status);
    return readText((await response.json()) as Parameters<typeof readText>[0]);
  };
}

export function pickProvider(env: Env): Generate {
  return vertexGenerate(env);
}

export function supportsVision(env: Env): boolean {
  return !!(env["GOOGLE_CLOUD_PROJECT"] || env["FIREBASE_PROJECT_ID"]);
}
