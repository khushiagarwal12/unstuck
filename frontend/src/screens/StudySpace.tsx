import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { DocumentInfo } from "../api/types";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { StatusChip } from "../ui/StatusChip";

interface StudySpaceProps {
  documentId: string;
  onBack: () => void;
  onStartSession: (conceptId: string) => void;
}

const STAGE_LABELS: Record<string, string> = {
  queued: "Waiting in queue...",
  extracting: "Extracting pages & text...",
  vision: "Transcribing scanned notes...",
  chunking: "Chunking study sections...",
  embedding: "Indexing for source citations...",
  concepts_ready: "Study topics ready!",
  ready: "Ready to study!",
};

export function StudySpace({ documentId, onBack, onStartSession }: StudySpaceProps) {
  const [doc, setDoc] = useState<DocumentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startingConcept, setStartingConcept] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const info = await api.getDocument(documentId);
        if (!active) return;
        setDoc(info);

        // Continue polling while processing
        if (info.status !== "ready" && info.status !== "error") {
          timer = setTimeout(poll, 2000);
        }
      } catch (e) {
        if (!active) return;
        const err = e instanceof ApiError ? e : new ApiError("error", "Failed to load document.");
        setError(err.message);
      }
    }

    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [documentId]);

  async function handleStart(conceptId: string) {
    setStartingConcept(conceptId);
    try {
      onStartSession(conceptId);
    } catch {
      setStartingConcept(null);
    }
  }

  const isProcessing = doc && doc.status !== "ready" && doc.status !== "concepts_ready" && doc.status !== "error";
  const canChooseConcept = doc && (doc.status === "ready" || doc.status === "concepts_ready");

  return (
    <main className="study-space">
      <header className="study-space__header">
        <Button variant="quiet" onClick={onBack}>
          &larr; Back to notes
        </Button>
        <div className="study-space__doc-meta">
          <h1 className="study-space__title">{doc?.fileName || "Your Notes"}</h1>
          {doc?.pageCount ? <span className="study-space__pages">{doc.pageCount} pages</span> : null}
          {doc?.isSample && <span className="chip chip--verified">Verified Sample Notes</span>}
        </div>
      </header>

      {error && <Banner>{error}</Banner>}

      {isProcessing && (
        <section className="processing-card" aria-live="polite">
          <div className="processing-card__spinner" />
          <div className="processing-card__info">
            <h2 className="processing-card__stage">{STAGE_LABELS[doc.status] || doc.statusDetail}</h2>
            <p className="processing-card__detail">{doc.statusDetail}</p>
            <div className="progress-bar">
              <div
                className="progress-bar__fill"
                style={{ width: `${Math.round((doc.progress || 0.1) * 100)}%` }}
              />
            </div>
          </div>
        </section>
      )}

      {canChooseConcept && (
        <section className="concepts-section">
          <div className="concepts-section__head">
            <h2 className="concepts-section__title">Topics in your material</h2>
            <p className="concepts-section__sub">
              Pick a topic to start diagnosing and mastering your weak spots.
            </p>
          </div>

          <div className="concepts-grid">
            {doc.concepts.map((concept) => (
              <div key={concept.id} className="concept-card">
                <div className="concept-card__top">
                  <h3 className="concept-card__name">{concept.name}</h3>
                  <StatusChip status="not_assessed" />
                </div>
                <p className="concept-card__desc">{concept.description}</p>

                {concept.prerequisites && concept.prerequisites.length > 0 && (
                  <div className="concept-card__prereqs">
                    <span className="concept-card__prereq-label">Builds on:</span>
                    <span className="concept-card__prereq-item">
                      {concept.prerequisites.join(", ")}
                    </span>
                  </div>
                )}

                <div className="concept-card__action">
                  <Button
                    disabled={startingConcept !== null}
                    onClick={() => handleStart(concept.id)}
                  >
                    {startingConcept === concept.id ? "Preparing session..." : "Start diagnostic"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
