// Mirrors backend/app/schemas.py and ARCHITECTURE.md section 7.
// The client never receives answer keys or option signals: only QuestionPublic.

export type Strategy = "hint" | "simplified" | "worked_example" | "analogy_visual" | "prerequisite_review";
export type MasteryStatus = "not_assessed" | "developing" | "demonstrated";

export interface SourceRef {
  chunk_id: string;
  page: number;
  quote: string;
}

export interface VisualSpec {
  type: "fraction_bar" | "number_line" | "area_model" | "none";
  params: Record<string, any>;
}

export interface QuestionPublic {
  id: string;
  stem: string;
  options: { id: string; text: string }[];
  visual?: VisualSpec | null;
}

export interface Hypothesis {
  misconception_id: string;
  label: string;
  probability: number; // posterior, not model self-report
  evidence: string;
  status: "tentative" | "supported";
}

export interface Explanation {
  strategy: Strategy;
  title: string;
  body_markdown: string;
  visual?: VisualSpec | null;
  source_refs: SourceRef[];
  grounded: boolean;
}

export interface Step {
  id: string;
  kind: "question" | "follow_up" | "explanation" | "summary" | "error";
  question?: QuestionPublic | null;
  explanation?: Explanation | null;
  hypothesis?: Hypothesis | null;
  concept_status_before: MasteryStatus;
  concept_status_after?: MasteryStatus | null;
  note?: string | null;
}

export interface Concept {
  id: string;
  conceptId?: string;
  name: string;
  description: string;
  prerequisites: string[];
  sourceRefs: SourceRef[];
  catalogStatus?: string;
}

export interface DocumentInfo {
  id: string;
  status: "queued" | "extracting" | "vision" | "chunking" | "embedding" | "concepts_ready" | "ready" | "error";
  progress: number;
  statusDetail: string;
  pageCount: number;
  fileName: string;
  isSample: boolean;
  warnings: string[];
  concepts: Concept[];
}

export interface SessionSummary {
  sessionId: string;
  conceptName: string;
  statusBefore: MasteryStatus;
  statusAfter: MasteryStatus;
  triedStrategies: Strategy[];
  cycleCount: number;
  activeHypothesis?: Hypothesis | null;
  attemptCount: number;
  sourceRefs: SourceRef[];
}

export interface ProgressData {
  concepts: {
    conceptId: string;
    conceptName: string;
    status: MasteryStatus;
    evidenceCount: number;
    lastAssessedAt: string;
  }[];
  recurringErrors: {
    id: string;
    label: string;
    count: number;
  }[];
  recentSessions: {
    id: string;
    conceptName: string;
    statusBefore: MasteryStatus;
    statusAfter: MasteryStatus;
    startedAt: string;
    completedAt?: string;
  }[];
}

export interface CoursePlanItem {
  conceptId: string;
  name: string;
  description: string;
  order: number;
  type: "confirm" | "learn";
  masteryStatus: MasteryStatus;
}

export interface CourseData {
  courseId: string;
  documentId: string;
  topic: string;
  status: "placement" | "ready";
  plan: CoursePlanItem[];
  placementQuestion?: QuestionPublic | null;
}

export interface UsageData {
  date: string;
  uploadsRemaining: number;
  uploadsMax: number;
  llmCallsRemaining: number;
  llmCallsMax: number;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; retryable: boolean };
}
