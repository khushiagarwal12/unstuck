import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { DocumentView } from "../api/types";

const FINISHED = new Set(["concepts_ready", "failed"]);
const MAX_CONSECUTIVE_ERRORS = 4;

/** Polls a document every 2 s (backing off after errors) until it is ready or has failed. */
export function useDocument(id: string) {
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    setError(null);

    async function tick() {
      try {
        const next = await api.getDocument(id);
        if (!alive.current) return;
        failures = 0;
        setDoc(next);
        if (!FINISHED.has(next.status)) timer = setTimeout(tick, 2000);
      } catch (e) {
        if (!alive.current) return;
        const err = e instanceof ApiError ? e : new ApiError("unknown", "Something went wrong. Try again.", true);
        failures += 1;
        if (!err.retryable || failures >= MAX_CONSECUTIVE_ERRORS) {
          setError(err);
          return;
        }
        timer = setTimeout(tick, Math.min(2000 * 2 ** failures, 10_000));
      }
    }

    void tick();
    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [id, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { doc, error, retry };
}
