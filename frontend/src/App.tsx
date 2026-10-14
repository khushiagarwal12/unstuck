import { useState } from "react";
import { BackendStatus } from "./components/BackendStatus";
import { Mark } from "./components/Mark";
import { useBackendStatus } from "./hooks/useBackendStatus";
import { Home } from "./screens/Home";
import { Study } from "./screens/Study";

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
        <Study documentId={documentId} onExit={() => setDocumentId(null)} />
      ) : (
        <Home onDocument={setDocumentId} />
      )}
    </div>
  );
}
