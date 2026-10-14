import type { BackendStatus as Status } from "../hooks/useBackendStatus";

const TEXT: Record<Status, string> = {
  checking: "Connecting",
  ready: "Tutor ready",
  waking: "Waking the tutor, this can take a minute",
  offline: "Tutor unreachable",
};

export function BackendStatus({ status, onRetry }: { status: Status; onRetry: () => void }) {
  return (
    <p className={`status status--${status}`} role="status">
      <span className="status__dot" aria-hidden="true" />
      {TEXT[status]}
      {status === "offline" && (
        <button type="button" className="status__retry" onClick={onRetry}>Retry</button>
      )}
    </p>
  );
}
