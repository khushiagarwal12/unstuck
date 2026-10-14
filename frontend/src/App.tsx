import { useState } from "react";
import { BackendStatus } from "./components/BackendStatus";
import { Mark } from "./components/Mark";
import { useBackendStatus } from "./hooks/useBackendStatus";
import { Home } from "./screens/Home";
import { Button } from "./ui/Button";

export default function App() {
  const { status, retry } = useBackendStatus();
  const [documentId, setDocumentId] = useState<string | null>(null);

  return (
    <div className="shell">
      <header className="top">
        <a className="brand" href="/" aria-label="UNSTUCK home">
          <Mark />
          <span className="brand__name">unstuck</span>
        </a>
        <BackendStatus status={status} onRetry={retry} />
      </header>

      {documentId ? (
        <main className="home">
          <section className="hero">
            <h1 className="hero__title">Reading your notes.</h1>
            <p className="hero__lead">The study space opens here once your material is ready.</p>
            <Button variant="quiet" onClick={() => setDocumentId(null)}>Back</Button>
          </section>
        </main>
      ) : (
        <Home onDocument={setDocumentId} />
      )}
    </div>
  );
}
