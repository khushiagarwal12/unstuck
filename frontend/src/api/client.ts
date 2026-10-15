import type {
  ApiErrorBody,
  CourseData,
  DocumentInfo,
  HealthResponse,
  ProgressData,
  SessionSummary,
  Step,
  UsageData,
} from "./types";

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

import { getAuthToken } from "../auth/firebase";

/** Auth token from Firebase (or dev fallback). */
async function getToken(): Promise<string> {
  return await getAuthToken();
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
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
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

  // Documents
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

  getDocument(docId: string) {
    return send<DocumentInfo>(`/api/documents/${docId}`, { method: "GET" });
  },

  deleteDocument(docId: string) {
    return send<{ ok: boolean }>(`/api/documents/${docId}`, { method: "DELETE" });
  },

  // Sessions
  createSession(documentId: string, conceptId: string) {
    return send<{ sessionId: string; step: Step }>("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId, conceptId }),
    });
  },

  getSessionStep(sessionId: string) {
    return send<{ sessionId: string; step: Step }>(`/api/sessions/${sessionId}`, { method: "GET" });
  },

  answerStep(sessionId: string, stepId: string, optionId?: string, freeText?: string, hintUsed?: boolean) {
    return send<{ sessionId: string; step: Step }>(`/api/sessions/${sessionId}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stepId, optionId, freeText, hintUsed: !!hintUsed }),
    });
  },

  challengeHypothesis(sessionId: string, stepId: string, freeText?: string) {
    return send<{ sessionId: string; step: Step }>(`/api/sessions/${sessionId}/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stepId, freeText }),
    });
  },

  getSessionSummary(sessionId: string) {
    return send<SessionSummary>(`/api/sessions/${sessionId}/summary`, { method: "GET" });
  },

  // Progress & Usage
  getProgress() {
    return send<ProgressData>("/api/progress", { method: "GET" });
  },

  getUsage() {
    return send<UsageData>("/api/usage", { method: "GET" });
  },

  // Courses (Learn with AI)
  createCourse(topic: string, level = "beginner", goal?: string) {
    return send<CourseData>("/api/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, level, goal }),
    });
  },

  getCourse(courseId: string) {
    return send<CourseData>(`/api/courses/${courseId}`, { method: "GET" });
  },

  answerPlacement(courseId: string, stepId: string, questionId: string, optionId: string) {
    return send<{ status: string; plan: CourseData["plan"]; placementQuestion?: CourseData["placementQuestion"] }>(
      `/api/courses/${courseId}/placement/answer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId, questionId, optionId }),
      },
    );
  },

  startModule(courseId: string, conceptId: string) {
    return send<{ sessionId: string; step: Step }>(`/api/courses/${courseId}/modules/${conceptId}/start`, {
      method: "POST",
    });
  },
};
