import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";

import { askTutor } from "@/lib/tutor.functions";

type Note = { greeting: string; focus: string; tip: string };
export type CoachConcept = {
  concept: string;
  status: string;
  misconceptions: string[];
  attempts: number;
  clean_successes: number;
  styles: string[];
};

type Props = {
  userId: string;
  firstName: string | null;
  prefs: Record<string, unknown> | undefined;
  concepts: CoachConcept[];
  dueCount: number;
  daysAway: number;
};

const read = (k: string): Note | null => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as Note) : null;
  } catch {
    return null;
  }
};
const write = (k: string, n: Note) => {
  try {
    localStorage.setItem(k, JSON.stringify(n));
  } catch {
    /* storage can be blocked */
  }
};

/** A short, personal coaching note built from the learner's real history. Hidden if the model is unavailable. */
export function CoachCard({ userId, firstName, prefs, concepts, dueCount, daysAway }: Props) {
  const ask = useServerFn(askTutor);
  const [note, setNote] = useState<Note | null>(null);
  const [failed, setFailed] = useState(false);

  const snapshot = useMemo(
    () => ({
      firstName,
      ...prefs,
      daysSinceLastSession: Math.floor(daysAway),
      reviewsDue: dueCount,
      concepts: concepts.slice(0, 8).map((c) => ({
        name: c.concept,
        status: c.status,
        attempts: c.attempts,
        cleanSuccesses: c.clean_successes,
        recurringMisconception: c.misconceptions[0] ?? null,
        explanationStylesTried: c.styles,
      })),
    }),
    [firstName, prefs, daysAway, dueCount, concepts],
  );

  // One note per learner per day per state of progress, so reloading does not spend model calls.
  const snapshotJson = useMemo(() => JSON.stringify(snapshot), [snapshot]);
  const cacheKey = `coach:${userId}:${new Date().toDateString()}:${snapshotJson.length}:${concepts.map((c) => c.status[0]).join("")}`;
  const askRef = useRef(ask);
  askRef.current = ask;
  const hasConcepts = concepts.length > 0;

  useEffect(() => {
    if (!hasConcepts) return;
    const cached = read(cacheKey);
    if (cached) {
      setNote(cached);
      setFailed(false);
      return;
    }
    let live = true;
    setFailed(false);
    askRef
      .current({
        data: { action: "coach", payload: JSON.parse(snapshotJson) as Record<string, unknown> },
      })
      .then(({ json }) => {
        if (!live) return;
        const n = JSON.parse(json) as Note;
        write(cacheKey, n);
        setNote(n);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [cacheKey, hasConcepts, snapshotJson]);

  if (concepts.length === 0 || failed) return null;
  return (
    <section className="card-paper p-6" aria-label="Your coach" aria-live="polite">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">Your coach</p>
      {note ? (
        <div className="mt-2 space-y-2">
          <p className="text-lg font-medium">{note.greeting}</p>
          <p>{note.focus}</p>
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">Tip:</strong> {note.tip}
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-2" aria-busy="true">
          <div className="h-5 w-2/3 animate-pulse rounded bg-secondary" />
          <div className="h-4 w-full animate-pulse rounded bg-secondary" />
        </div>
      )}
    </section>
  );
}
