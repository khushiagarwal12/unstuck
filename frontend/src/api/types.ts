// Mirrors backend/app/schemas.py. Change both together (ARCHITECTURE.md rule 1).
// The client never receives answer keys or option signals: only QuestionPublic.

export type Strategy = "hint" | "simplified" | "worked_example" | "analogy_visual" | "prerequisite_review";
export type MasteryStatus = "not_assessed" | "developing" | "demonstrated";

export interface SourceRef { chunk_id: string; page: number; quote: string }

export interface VisualSpec {
  type: "fraction_bar" | "number_line" | "area_model" | "none";
  params: Record<string, unknown>;
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

export interface HealthResponse { ok: boolean; version: string }

export interface ApiErrorBody { error: { code: string; message: string; retryable: boolean } }

export type DocumentStatus = "queued" | "reading" | "indexing" | "finding_concepts" | "concepts_ready" | "failed";

export interface ConceptCard {
  id: string;
  name: string;
  description: string;
  prerequisites: string[]; // concept ids
  pages: number[];
}

export interface DocumentView {
  id: string;
  title: string;
  status: DocumentStatus;
  progress: number; // 0-100
  statusDetail: string;
  pageCount: number;
  warnings: string[];
  error: { code: string; message: string } | null;
  isSample: boolean;
  concepts?: ConceptCard[];
}
