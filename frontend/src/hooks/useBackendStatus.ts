import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";

export type BackendStatus = "checking" | "ready" | "waking" | "offline";

const SLOW_AFTER_MS = 2_500;
const GIVE_UP_AFTER_MS = 90_000;
const RETRY_EVERY_MS = 3_000;

/**
 * The free host sleeps when idle and takes about a minute to wake. Ping /health on load so the
 * student sees "Waking the tutor" instead of a dead page.
 */
export function useBackendStatus() {
  const [status, setStatus] = useState<BackendStatus>("checking");
  const run = useRef(0);

  const start = useCallback(() => {
    const id = ++run.current;
    const began = Date.now();
    setStatus("checking");
    const slow = setTimeout(() => {
      if (run.current === id) setStatus((s) => (s === "checking" ? "waking" : s));
    }, SLOW_AFTER_MS);

    const attempt = async () => {
      try {
        await api.health();
        if (run.current === id) setStatus("ready");
      } catch {
        if (run.current !== id) return;
        if (Date.now() - began > GIVE_UP_AFTER_MS) setStatus("offline");
        else {
          setStatus("waking");
          setTimeout(attempt, RETRY_EVERY_MS);
        }
      }
    };
    void attempt();
    return () => { clearTimeout(slow); run.current++; };
  }, []);

  useEffect(() => start(), [start]);
  return { status, retry: start };
}
