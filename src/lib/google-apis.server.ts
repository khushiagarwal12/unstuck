/** Google Cloud APIs beyond Gemini: Text-to-Speech, Translation and the YouTube Data API. */
import { accessToken, type Env, readServiceAccount } from "./google-auth.server";

const TIMEOUT_MS = 20_000;

export class GoogleApiError extends Error {}

function failure(status: number, what: string): GoogleApiError {
  if (status === 429) return new GoogleApiError("Too many requests right now. Wait a moment and retry.");
  if (status === 403 || status === 401) return new GoogleApiError(`${what} isn't enabled for this project's credentials.`);
  return new GoogleApiError(`${what} is unavailable right now (${status}). Try again.`);
}

async function headers(env: Env): Promise<Record<string, string>> {
  const key = env["GOOGLE_API_KEY"];
  if (key) return { "x-goog-api-key": key, "Content-Type": "application/json" };
  return { Authorization: `Bearer ${await accessToken(env)}`, "Content-Type": "application/json" };
}

export const speechAvailable = (env: Env) => !!(env["GOOGLE_API_KEY"] || env["GOOGLE_ACCESS_TOKEN"] || readServiceAccount(env));
export const translateAvailable = speechAvailable;
export const videoAvailable = (env: Env) => !!env["GOOGLE_API_KEY"];

/** Cloud Text-to-Speech. Returns base64 MP3. */
export async function synthesizeSpeech(env: Env, text: string, languageCode: string): Promise<string> {
  const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    headers: await headers(env),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      input: { text },
      voice: { languageCode },
      audioConfig: { audioEncoding: "MP3", speakingRate: 0.95 },
    }),
  });
  if (!res.ok) throw failure(res.status, "Read-aloud");
  const { audioContent } = (await res.json()) as { audioContent?: string };
  if (!audioContent) throw new GoogleApiError("Read-aloud returned no audio. Try again.");
  return audioContent;
}

/** Cloud Translation (Basic). Output keeps the order of the input. */
export async function translateTexts(env: Env, texts: string[], target: string): Promise<string[]> {
  const res = await fetch("https://translation.googleapis.com/language/translate/v2", {
    method: "POST",
    headers: await headers(env),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({ q: texts, target, format: "text" }),
  });
  if (!res.ok) throw failure(res.status, "Translation");
  const data = (await res.json()) as { data?: { translations?: { translatedText?: string }[] } };
  const out = data.data?.translations?.map((t) => t.translatedText ?? "") ?? [];
  if (out.length !== texts.length) throw new GoogleApiError("Translation returned an incomplete answer. Try again.");
  return out;
}

export type Video = { id: string; title: string; channel: string };

/** YouTube Data API: one embeddable, safe-search video about the concept. */
export async function findVideo(env: Env, query: string, language: string): Promise<Video | null> {
  const key = env["GOOGLE_API_KEY"];
  if (!key) throw new GoogleApiError("Video search isn't configured.");
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    q: `${query} explained`,
    maxResults: "1",
    videoEmbeddable: "true",
    safeSearch: "strict",
    videoDuration: "medium",
    relevanceLanguage: language,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
    headers: { "x-goog-api-key": key },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw failure(res.status, "Video search");
  const data = (await res.json()) as { items?: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }[] };
  const item = data.items?.[0];
  if (!item?.id?.videoId) return null;
  return { id: item.id.videoId, title: item.snippet?.title ?? "Video", channel: item.snippet?.channelTitle ?? "" };
}
