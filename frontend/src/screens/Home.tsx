import { useRef, useState, type DragEvent } from "react";
import { api, ApiError } from "../api/client";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";

const MAX_BYTES = 15 * 1024 * 1024;
const OK_TYPES = ["application/pdf", "image/png", "image/jpeg"];
const MIN_PASTE = 80;
const MAX_PASTE = 60_000;

const STEPS = [
  "Answer a question",
  "See the likely mistake",
  "Learn it another way",
  "Prove it with a fresh question",
];

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function Home({ onDocument }: { onDocument: (documentId: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<"start" | "sample" | null>(null);
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

  async function run(kind: "start" | "sample", job: () => Promise<{ documentId: string }>) {
    setBusy(kind);
    setError(null);
    try {
      const { documentId } = await job();
      onDocument(documentId);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("unknown", "Something went wrong. Try again.", true);
      setError({ message: err.message, retry: err.retryable ? () => void run(kind, job) : undefined });
    } finally {
      setBusy(null);
    }
  }

  const start = () =>
    run("start", () => (file ? api.uploadDocument(file) : api.createDocumentFromText("Pasted notes", trimmed)));
  const sample = () => run("sample", () => api.createSampleDocument());

  return (
    <main className="home">
      <section className="hero" aria-labelledby="headline">
        <h1 id="headline" className="hero__title">Find out why you're stuck.</h1>
        <p className="hero__lead">
          Bring your own notes. UNSTUCK finds the mistake behind your wrong answers, teaches it a
          different way, and checks that it worked.
        </p>
      </section>

      <section className="panel" aria-labelledby="panel-title">
        <h2 id="panel-title" className="panel__title">Study your notes</h2>

        {file ? (
          <div className="file">
            <div>
              <p className="file__name">{file.name}</p>
              <p className="file__meta">{formatSize(file.size)}</p>
            </div>
            <Button variant="quiet" onClick={() => { setFile(null); if (input.current) input.current.value = ""; }}>
              Remove
            </Button>
          </div>
        ) : (
          <label
            className={`drop ${dragging ? "drop--over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
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
            <span className="drop__main">Drop a PDF or photo of your notes</span>
            <span className="drop__sub">or click to choose a file. PDF, PNG or JPG, up to 15&nbsp;MB.</span>
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
              {pasteOpen ? "Hide pasted notes" : "Paste notes instead"}
            </button>
            {pasteOpen && (
              <>
                <label htmlFor="paste-area" className="sr-only">Your notes</label>
                <textarea
                  id="paste-area"
                  className="paste__area"
                  rows={7}
                  value={text}
                  maxLength={MAX_PASTE}
                  placeholder="Paste a few paragraphs from your textbook or notes."
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

        {error && (
          <Banner action={error.retry && <Button variant="quiet" onClick={error.retry}>Try again</Button>}>
            {error.message}
          </Banner>
        )}

        <div className="actions">
          <Button disabled={!canStart || busy !== null} onClick={start}>
            {busy === "start" ? "Starting" : "Start learning"}
          </Button>
          <Button variant="quiet" disabled={busy !== null} onClick={sample}>
            {busy === "sample" ? "Opening sample" : "Try the sample notes"}
          </Button>
        </div>

        <div className="topic">
          <div className="topic__head">
            <label htmlFor="topic-input" className="topic__label">Learn with AI</label>
            <span className="chip chip--soon">Soon</span>
          </div>
          <input
            id="topic-input"
            className="topic__input"
            type="text"
            disabled
            placeholder="Type a topic, like photosynthesis"
          />
        </div>
      </section>

      <ol className="steps" aria-label="How it works">
        {STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>

      <p className="fineprint">
        Don't upload private material. On the free tier, Google may use content sent to Gemini to
        improve its products. We never keep your original file.
      </p>
    </main>
  );
}
