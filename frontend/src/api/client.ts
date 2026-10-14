import type { ApiErrorBody, HealthResponse } from "./types";

const BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
    public status = 0,
  ) {
    super(message);
  }
}

/** Day 1 swaps this for the Firebase anonymous-auth ID token. */
async function getToken(): Promise<string> {
  if (import.meta.env.VITE_DEV_AUTH === "1") return "dev-local";
  throw new ApiError("auth_not_ready", "Sign-in isn't set up yet.");
}

async function send<T>(path: string, init: RequestInit & { auth?: boolean; timeoutMs?: number } = {}): Promise<T> {
  const { auth = true, timeoutMs = 30_000, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (auth) headers.set("Authorization", `Bearer ${await getToken()}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...rest, headers, signal: controller.signal });
  } catch {
    throw new ApiError("network", "Can't reach the tutor. Check your connection and try again.", true);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let body: ApiErrorBody | undefined;
    try { body = await res.json(); } catch { /* not JSON */ }
    if (body?.error) throw new ApiError(body.error.code, body.error.message, body.error.retryable, res.status);
    if (res.status === 404 || res.status === 405) {
      throw new ApiError("not_available", "The server doesn't support that yet.", false, res.status);
    }
    throw new ApiError("http_error", "Something went wrong. Try again.", res.status >= 500, res.status);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => send<HealthResponse>("/health", { auth: false, timeoutMs: 4_000 }),

  uploadDocument(file: File) {
    const form = new FormData();
    form.append("file", file);
    return send<{ documentId: string; status: string }>("/api/documents", { method: "POST", body: form });
  },

  createDocumentFromText(title: string, text: string) {
    return send<{ documentId: string; status: string }>("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, text }),
    });
  },

  createSampleDocument() {
    return send<{ documentId: string }>("/api/documents/sample", { method: "POST" });
  },
};
