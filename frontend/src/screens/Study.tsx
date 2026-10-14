import { useState } from "react";
import { api, ApiError } from "../api/client";
import type { ConceptCard, DocumentStatus, DocumentView } from "../api/types";
import { useDocument } from "../hooks/useDocument";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";

const STAGES: { status: DocumentStatus; label: string }[] = [
  { status: "queued", label: "Receiving your material" },
  { status: "reading", label: "Reading scanned pages" },
  { status: "indexing", label: "Indexing your material" },
  { status: "finding_concepts", label: "Finding the key ideas" },
];

function pagesLabel(pages: number[]) {
  if (pages.length === 0) return "";
  return pages.length === 1 ? `Page ${pages[0]}` : `Pages ${pages.join(", ")}`;
}

function Progress({ doc }: { doc: DocumentView }) {
  // The reading stage only runs for scans, so hide it unless the server says it is happening.
  const stages = STAGES.filter((s) => s.status !== "reading" || doc.status === "reading");
  const activeIndex = stages.findIndex((s) => s.status === doc.status);
  return (
    <section className="panel" aria-labelledby="progress-title" aria-live="polite">
      <h2 id="progress-title" className="panel__title">Getting your notes ready</h2>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={doc.progress}>
        <div className="bar__fill" style={{ width: `${Math.max(doc.progress, 5)}%` }} />
      </div>
      <ol className="stages">
        {stages.map((s, i) => (
          <li key={s.status} className={i < activeIndex ? "stage stage--done" : i === activeIndex ? "stage stage--now" : "stage"}>
            {s.label}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ConceptList({ concepts }: { concepts: ConceptCard[] }) {
  const names = new Map(concepts.map((c) => [c.id, c.name]));
  return (
    <ol className="concepts">
      {concepts.map((c, i) => (
        <li key={c.id} className="concept">
          <span className="concept__num" aria-hidden="true">{i + 1}</span>
          <div className="concept__body">
            <h3 className="concept__name">{c.name}</h3>
            <p className="concept__desc">{c.description}</p>
            <p className="concept__meta">
              {pagesLabel(c.pages)}
              {c.prerequisites.length > 0 && (
                <> · Builds on {c.prerequisites.map((p) => names.get(p) ?? p).join(", ")}</>
              )}
            </p>
          </div>
          <span className="chip chip--not_assessed">Not started</span>
        </li>
      ))}
    </ol>
  );
}

export function Study({ documentId, onExit }: { documentId: string; onExit: () => void }) {
  const { doc, error, retry } = useDocument(documentId);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function remove() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteDocument(documentId);
      onExit();
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : "Couldn't delete that. Try again.");
      setDeleting(false);
    }
  }

  return (
    <main className="study">
      <div className="study__head">
        <Button variant="quiet" onClick={onExit}>Back</Button>
        {doc && <h1 className="study__title">{doc.title}</h1>}
      </div>

      {error && (
        <Banner action={error.retryable && <Button variant="quiet" onClick={retry}>Try again</Button>}>
          {error.message}
        </Banner>
      )}

      {!error && !doc && <p className="study__wait" role="status">Opening your notes…</p>}

      {doc && doc.status === "failed" && (
        <>
          <Banner>{doc.error?.message ?? "We couldn't finish reading that."}</Banner>
          <div><Button onClick={onExit}>Choose another file</Button></div>
        </>
      )}

      {doc && doc.status !== "failed" && doc.status !== "concepts_ready" && <Progress doc={doc} />}

      {doc && doc.status === "concepts_ready" && (
        <>
          <section aria-labelledby="concepts-title">
            <h2 id="concepts-title" className="study__sub">
              {doc.concepts?.length ?? 0} ideas to work through
            </h2>
            {doc.warnings.map((w) => (
              <Banner key={w} tone="info">{w}</Banner>
            ))}
            <ConceptList concepts={doc.concepts ?? []} />
          </section>
          <Banner tone="info">
            Choosing an idea to practise opens in the next update.
          </Banner>
          {deleteError && <Banner>{deleteError}</Banner>}
          <div>
            <Button variant="quiet" disabled={deleting} onClick={remove}>
              {deleting ? "Deleting" : "Delete these notes"}
            </Button>
          </div>
        </>
      )}
    </main>
  );
}
