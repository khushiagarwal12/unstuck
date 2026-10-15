import { useRef, useState, type DragEvent } from "react";
import { api, ApiError } from "../api/client";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";

const MAX_BYTES = 15 * 1024 * 1024;
const OK_TYPES = ["application/pdf", "image/png", "image/jpeg"];
const MIN_PASTE = 80;
const MAX_PASTE = 60_000;

const STEPS = [
  "Answer a diagnostic question",
  "See the likely mistake pattern",
  "Learn it with visual analogies and citations",
  "Prove understanding with fresh practice",
];

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface HomeProps {
  onDocument: (documentId: string) => void;
  onCourse: (courseId: string) => void;
  onViewProgress: () => void;
}

export function Home({ onDocument, onCourse, onViewProgress }: HomeProps) {
  const [file, setFile] = useState<File | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [text, setText] = useState("");
  const [topic, setTopic] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<"start" | "sample" | "course" | null>(null);
  const [error, setError] = useState<{ message: string; retry?: () => void } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const trimmed = text.trim();
  const canStart = !!file || (pasteOpen && trimmed.length >= MIN_PASTE && trimmed.length <= MAX_PASTE);

  function pick(f: File | undefined | null) {
    if (!f) return;
    if (!OK_TYPES.includes(f.type) || f.size > MAX_BYTES) {
      setError({ message: "Choose a PDF, PNG or JPG that is 15 MB or smaller." });
      return;
    }
    setError(null);
    setFile(f);
    setPasteOpen(false);
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files?.[0]);
  }

  async function runDoc(kind: "start" | "sample", job: () => Promise<{ documentId: string }>) {
    setBusy(kind);
    setError(null);
    try {
      const { documentId } = await job();
      onDocument(documentId);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("unknown", "Something went wrong. Try again.", true);
      setError({ message: err.message, retry: err.retryable ? () => void runDoc(kind, job) : undefined });
    } finally {
      setBusy(null);
    }
  }

  async function startCourse() {
    const t = topic.trim();
    if (t.length < 3) {
      setError({ message: "Type a topic with at least 3 characters." });
      return;
    }
    setBusy("course");
    setError(null);
    try {
      const res = await api.createCourse(t);
      onCourse(res.courseId);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("unknown", "Could not create course. Try again.", true);
      setError({ message: err.message });
    } finally {
      setBusy(null);
    }
  }

  const start = () =>
    runDoc("start", () => (file ? api.uploadDocument(file) : api.createDocumentFromText("Pasted notes", trimmed)));
  const sample = () => runDoc("sample", () => api.createSampleDocument());

  return (
    <main className="home">
      <section className="hero" aria-labelledby="headline">
        <h1 id="headline" className="hero__title">Find out why you're stuck.</h1>
        <p className="hero__lead">
          Bring your own notes or study a topic with AI. UNSTUCK diagnoses the root misconception behind your mistakes,
          adapts its teaching with grounded citations, and proves understanding with fresh questions.
        </p>
      </section>

      <div className="home-grid">
        {/* Card 1: Study My Notes */}
        <section className="panel" aria-labelledby="panel-notes">
          <div className="panel__head">
            <span className="panel__badge">Study Your Notes</span>
            <h2 id="panel-notes" className="panel__title">Bring your study material</h2>
          </div>

          {file ? (
            <div className="file">
              <div>
                <p className="file__name">{file.name}</p>
                <p className="file__meta">{formatSize(file.size)}</p>
              </div>
              <Button
                variant="quiet"
                onClick={() => {
                  setFile(null);
                  if (input.current) input.current.value = "";
                }}
              >
                Remove
              </Button>
            </div>
          ) : (
            <label
              className={`drop ${dragging ? "drop--over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <input
                ref={input}
                className="drop__input"
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                onChange={(e) => pick(e.target.files?.[0])}
              />
              <span className="drop__main">Drop a PDF or photo of notes</span>
              <span className="drop__sub">PDF, PNG or JPG up to 15 MB.</span>
            </label>
          )}

          {!file && (
            <div className="paste">
              <button
                type="button"
                className="link"
                aria-expanded={pasteOpen}
                aria-controls="paste-area"
                onClick={() => setPasteOpen((o) => !o)}
              >
                {pasteOpen ? "Hide pasted text" : "Paste notes instead"}
              </button>
              {pasteOpen && (
                <>
                  <label htmlFor="paste-area" className="sr-only">Your notes</label>
                  <textarea
                    id="paste-area"
                    className="paste__area"
                    rows={6}
                    value={text}
                    maxLength={MAX_PASTE}
                    placeholder="Paste textbook sections, definitions, or problem notes..."
                    onChange={(e) => setText(e.target.value)}
                  />
                  <p className="paste__hint">
                    {trimmed.length < MIN_PASTE
                      ? `Add a little more: ${MIN_PASTE - trimmed.length} characters to go.`
                      : `${trimmed.length.toLocaleString()} characters`}
                  </p>
                </>
              )}
            </div>
          )}

          <div className="actions">
            <Button disabled={!canStart || busy !== null} onClick={start}>
              {busy === "start" ? "Processing notes..." : "Start learning from notes"}
            </Button>
            <Button variant="quiet" disabled={busy !== null} onClick={sample}>
              {busy === "sample" ? "Opening sample..." : "Try the verified fractions sample"}
            </Button>
          </div>
        </section>

        {/* Card 2: Learn with AI */}
        <section className="panel" aria-labelledby="panel-ai">
          <div className="panel__head">
            <span className="panel__badge">Learn with AI</span>
            <h2 id="panel-ai" className="panel__title">Explore Any Topic</h2>
          </div>
          <p className="panel__desc">
            No notes? Type any topic. UNSTUCK runs a diagnostic placement check and builds an ordered roadmap targeting only what you haven't mastered.
          </p>

          <div className="topic">
            <label htmlFor="topic-input" className="topic__label">Enter study topic</label>
            <div className="topic__input-group">
              <input
                id="topic-input"
                className="topic__input"
                type="text"
                value={topic}
                placeholder="e.g. Fractions, Photosynthesis, Newton's Laws"
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && topic.trim()) startCourse();
                }}
              />
              <Button disabled={!topic.trim() || busy !== null} onClick={startCourse}>
                {busy === "course" ? "Scoping..." : "Build Course"}
              </Button>
            </div>
          </div>
        </section>
      </div>

      {error && (
        <Banner action={error.retry && <Button variant="quiet" onClick={error.retry}>Try again</Button>}>
          {error.message}
        </Banner>
      )}

      <ol className="steps" aria-label="How it works">
        {STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>

      <div className="home__progress-prompt">
        <span>Already studying?</span>{" "}
        <button type="button" className="link" onClick={onViewProgress}>
          Review your mastery progress &amp; diagnostic history &rarr;
        </button>
      </div>

      <p className="fineprint">
        Privacy Notice: Don't upload confidential or private material. On free tier services, content processed by Gemini may be reviewed to improve Google products. We never store original files.
      </p>
    </main>
  );
}
