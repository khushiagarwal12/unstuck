import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { LessonTools, type Caps } from "@/components/LessonTools";
import { getCapabilities, readProblem } from "@/lib/google.functions";
import { shrinkImage } from "@/lib/image";
import { clearSession, readSession, writeSession } from "@/lib/session-storage";
import { askTutor, checkTutorAnswer } from "@/lib/tutor.functions";

type Option = { text: string };
type Diag = { concept: string; question: string; options: Option[]; answerToken: string; why: string };
type Hyp = { label: string; summary: string; confidence: "low" | "medium" | "high" };
type Diagnosis = { demonstrated: string[]; hypotheses: Hyp[]; unresolved: string[]; needsFollowUp: boolean; followUp: { question: string; options: string[]; why: string } | null; recommendedStyle: Style };
type Style = "visual" | "example" | "hint" | "simpler" | "analogy" | "prerequisite";
type Lesson = { title: string; body: string; diagram: string | null; steps: string[]; style: Style };
type Transfer = { question: string; options: string[]; answerToken: string; context: string; explanation?: string };
export type Status = "Not assessed" | "Needs more practice" | "Progressing" | "Demonstrated under current criteria";
export type SessionRecord = { concept: string; status: Status; misconceptions: string[]; styles: Style[]; hintsUsed: number; correct: boolean; clean: boolean; explanation: string | null };

const STYLES: { id: Style; label: string }[] = [
  { id: "visual", label: "Show me visually" },
  { id: "example", label: "Walk me through an example" },
  { id: "hint", label: "Just give me a hint" },
  { id: "simpler", label: "Explain it more simply" },
  { id: "analogy", label: "Use a real-world analogy" },
  { id: "prerequisite", label: "Review the basics first" },
];

const SAMPLES = [
  "Why is 1/8 smaller than 1/3 if 8 is bigger?",
  "I keep mixing up velocity and acceleration",
  "Why does a negative times a negative give a positive?",
];

type Stage = "start" | "diagnostic" | "diagnosis" | "lesson" | "transfer" | "done";
const STAGES: { id: Stage; label: string }[] = [
  { id: "diagnostic", label: "Check" },
  { id: "diagnosis", label: "Diagnose" },
  { id: "lesson", label: "Teach" },
  { id: "transfer", label: "Verify" },
];

export function LearnSession({ initialTopic, prefs, onRecord, onExit, storageKey }: { initialTopic?: string; prefs?: Record<string, unknown>; onRecord?: (r: SessionRecord) => void; onExit?: () => void; storageKey?: string }) {
  const ask = useServerFn(askTutor);
  const checkAnswer = useServerFn(checkTutorAnswer);
  const readPhoto = useServerFn(readProblem);
  const loadCaps = useServerFn(getCapabilities);
  const [caps, setCaps] = useState<Caps>({ vision: false, speech: false, translate: false, video: false });
  const [reading, setReading] = useState(false);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  useEffect(() => { loadCaps().then(setCaps).catch(() => undefined); }, [loadCaps]);
  const [stage, setStage] = useState<Stage>("start");
  const [topic, setTopic] = useState("");
  const [notes, setNotes] = useState("");
  const [diag, setDiag] = useState<Diag | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [diagnosticCorrect, setDiagnosticCorrect] = useState<boolean | null>(null);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [followUps, setFollowUps] = useState<{ q: string; a: string }[]>([]);
  const [disputed, setDisputed] = useState<string[]>([]);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [styles, setStyles] = useState<Style[]>([]);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [tPick, setTPick] = useState<number | null>(null);
  const [history, setHistory] = useState<{ context: string; correct: boolean; clean: boolean }[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<{ msg: string; retry?: () => void } | null>(null);
  const [hydrated, setHydrated] = useState(!storageKey);
  const started = useRef(false);
  const restored = useRef(false);
  const restoreFailed = useRef(false);
  useEffect(() => {
    if (!storageKey) { setHydrated(true); return; }
    try {
      const saved = readSession(window.localStorage, storageKey);
      if (saved) {
        restored.current = true;
        setStage(saved.stage); setTopic(saved.topic); setNotes(saved.notes); setDiag(saved.diag); setPicked(saved.picked);
        setDiagnosticCorrect(saved.diagnosticCorrect); setDiagnosis(saved.diagnosis); setFollowUps(saved.followUps);
        setDisputed(saved.disputed); setLesson(saved.lesson); setStyles(saved.styles); setTransfer(saved.transfer);
        setTPick(saved.tPick); setHistory(saved.history);
      }
    } catch {
      restoreFailed.current = true;
      setError({ msg: "We couldn't restore this saved session. It remains on this device." });
    } finally {
      setHydrated(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated || !storageKey || restoreFailed.current) return;
    try {
      if (stage === "start" && !topic.trim() && !diag) {
        clearSession(window.localStorage, storageKey);
        return;
      }
      writeSession(window.localStorage, storageKey, {
        stage, topic, notes, diag, picked, diagnosticCorrect, diagnosis, followUps, disputed,
        lesson, styles, transfer, tPick, history,
      });
    } catch {
      setError({ msg: "This session couldn't be saved on this device. Allow local storage to keep your place." });
    }
  }, [hydrated, storageKey, stage, topic, notes, diag, picked, diagnosticCorrect, diagnosis, followUps, disputed, lesson, styles, transfer, tPick, history]);

  useEffect(() => {
    if (hydrated && !restoreFailed.current && !restored.current && initialTopic && !started.current) { started.current = true; start(initialTopic); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTopic, hydrated]);

  async function call<T>(label: string, action: "start" | "diagnose" | "intervene" | "transfer", payload: Record<string, unknown>, onOk: (r: T) => void) {
    if (loading) return;
    const run = () => call(label, action, payload, onOk);
    setLoading(label); setError(null);
    try {
      const { json } = await ask({ data: { action, payload } }); const result: unknown = JSON.parse(json);
      onOk(result as T);
    } catch (e) {
      setError({ msg: e instanceof Error ? e.message : "Something went wrong", retry: run });
    } finally { setLoading(null); }
  }

  const baseCtx = () => ({ topic, learnerPreferences: prefs, notes: notes.slice(0, 6000) || undefined, concept: diag?.concept, diagnosticQuestion: diag?.question, diagnosticOptions: diag?.options.map((option) => option.text), learnerAnswer: picked != null ? diag?.options[picked]?.text : undefined, diagnosticCorrect });

  const start = (t = topic) => {
    restoreFailed.current = false;
    if (storageKey) {
      try { clearSession(window.localStorage, storageKey); } catch { setError({ msg: "We couldn't replace the saved session on this device." }); return; }
    }
    setTopic(t);
    reset(false);
    call<Diag>("Preparing a quick check…", "start", { stuckOn: t, learnerPreferences: prefs, notes: notes.slice(0, 6000) || undefined }, (r) => { setDiag(r); setStage("diagnostic"); });
  };

  const snap = async (file: File | undefined) => {
    if (!file) return;
    setReading(true); setPhotoErr(null);
    try {
      const { text } = await readPhoto({ data: await shrinkImage(file) });
      setTopic((t) => (t.trim() ? `${t.trim()}\n${text}` : text));
    } catch (e) { setPhotoErr(e instanceof Error ? e.message : "We couldn't read that photo."); }
    finally { setReading(false); }
  };

  const reset = (full = true) => {
    setDiag(null); setPicked(null); setDiagnosticCorrect(null); setDiagnosis(null); setFollowUps([]); setDisputed([]); setLesson(null); setStyles([]); setTransfer(null); setTPick(null); setHistory([]); setError(null);
    if (full) {
      if (storageKey) try { clearSession(window.localStorage, storageKey); } catch { setError({ msg: "We couldn't clear the saved session on this device." }); }
      restored.current = false;
      setStage("start"); setTopic(""); onExit?.();
    }
  };

  const runDiagnose = (fu = followUps, disp = disputed, observedCorrect = diagnosticCorrect) =>
    call<Diagnosis>("Weighing what might be going on…", "diagnose", { ...baseCtx(), diagnosticCorrect: observedCorrect, followUpAnswers: fu, disputedHypotheses: disp, followUpCount: fu.length }, (r) => {
      setDiagnosis(r); setStage("diagnosis");
    });

  const verifyAnswer = async (kind: "diagnostic" | "transfer", answerToken: string, choice: number) => {
    if (loading) return null;
    const retry = () => {
      if (kind === "diagnostic") void submitDiag();
      else void answerTransfer();
    };
    setLoading("Checking your answer…"); setError(null);
    try {
      return await checkAnswer({ data: { kind, answerToken, choice } });
    } catch (e) {
      setError({ msg: e instanceof Error ? e.message : "Something went wrong", retry });
      return null;
    } finally {
      setLoading(null);
    }
  };

  const submitDiag = async () => {
    if (picked == null || !diag) return;
    const result = await verifyAnswer("diagnostic", diag.answerToken, picked);
    if (!result) return;
    setDiagnosticCorrect(result.correct);
    runDiagnose(followUps, disputed, result.correct);
  };

  const teach = (style: Style) =>
    call<Omit<Lesson, "style">>("Building a new explanation…", "intervene", { ...baseCtx(), diagnosis: diagnosis?.hypotheses.filter((h) => !disputed.includes(h.label)), style, previousStyles: styles }, (r) => {
      setLesson({ ...r, style }); setStyles((s) => [...s, style]); setStage("lesson");
    });

  const getTransfer = (h = history) =>
    call<Transfer>("Writing a fresh question…", "transfer", {
      ...baseCtx(),
      previousTransferContexts: h.map((x) => x.context),
      previousTransferResults: h.map(({ context, correct, clean }) => ({ context, correct, clean })),
    }, (r) => {
      setTransfer(r); setTPick(null); setStage("transfer");
    });

  const usedHint = styles.includes("hint");
  const cleanStreak = (() => { let n = 0; for (let i = history.length - 1; i >= 0 && history[i]?.clean; i--) n++; return n; })();
  const status: Status = history.length === 0 ? "Not assessed" : cleanStreak >= 2 && new Set(history.slice(-2).map((h) => h.context)).size === 2 ? "Demonstrated under current criteria" : history[history.length - 1]?.correct ? "Progressing" : "Needs more practice";

  const answerTransfer = async () => {
    if (tPick == null || !transfer || !diag) return;
    const result = await verifyAnswer("transfer", transfer.answerToken, tPick);
    if (!result) return;
    const correct = result.correct;
    setTransfer({ ...transfer, explanation: result.explanation });
    const h = [...history, { context: transfer.context, correct, clean: correct && !usedHint }];
    setHistory(h);
    const st: Status = (() => { let n = 0; for (let i = h.length - 1; i >= 0 && h[i]?.clean; i--) n++; return n >= 2 && new Set(h.slice(-2).map((x) => x.context)).size === 2 ? "Demonstrated under current criteria" : correct ? "Progressing" : "Needs more practice"; })();
    onRecord?.({ concept: diag.concept, status: st, misconceptions: diagnosis?.hypotheses.filter((x) => !disputed.includes(x.label)).map((x) => x.summary).slice(0, 2) ?? [], styles, hintsUsed: styles.filter((s) => s === "hint").length, correct, clean: correct && !usedHint, explanation: lesson ? `${lesson.title}\n${lesson.body}` : null });
    setStage("done");
  };

  const stageIdx = STAGES.findIndex((s) => s.id === (stage === "done" ? "transfer" : stage));


  return (
    <section className="min-w-0">
          {stage !== "start" && (
            <ol className="mb-6 flex flex-wrap items-center gap-2 text-sm" aria-label="Session progress">
              {STAGES.map((s, i) => (
                <li key={s.id} className={`rounded-full px-3 py-1 ${i === stageIdx ? "bg-primary text-primary-foreground" : i < stageIdx ? "bg-secondary text-secondary-foreground" : "text-muted-foreground"}`}>{s.label}</li>
              ))}
            </ol>
          )}
          {error && (
            <div role="alert" className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
              <span>{error.msg}</span>
              {error.retry && <button onClick={error.retry} className="rounded-md bg-destructive px-3 py-1.5 text-destructive-foreground">Retry</button>}
            </div>
          )}
          {loading && <div className="mb-4 flex items-center gap-3 text-muted-foreground" aria-live="polite"><span className="h-2 w-2 animate-ping rounded-full bg-accent" />{loading}</div>}

          {stage === "start" && (
            <div className="pt-6">
              <h2 className="text-3xl font-semibold">What are you stuck on?</h2>
              <form className="card-paper mt-6 p-5" onSubmit={(e) => { e.preventDefault(); if (topic.trim()) start(); }}>
                <label htmlFor="topic" className="text-sm font-medium">What are you stuck on?</label>
                <textarea id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} rows={3} placeholder="Paste a question, a concept, or a mistake you keep making…" className="mt-2 w-full resize-none rounded-lg border bg-background p-3 outline-none focus:ring-2 focus:ring-ring" />
                {caps.vision && (
                  <div className="mt-3 text-sm">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 hover:bg-secondary">
                      <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={reading || !!loading} onChange={(e) => { void snap(e.target.files?.[0]); e.target.value = ""; }} />
                      {reading ? "Reading your photo…" : "Snap or upload the problem"}
                    </label>
                    <span className="ml-2 text-xs text-muted-foreground">Read by Google Gemini. You can edit the text before you continue.</span>
                    {photoErr && <p role="alert" className="mt-2 text-destructive">{photoErr}</p>}
                  </div>
                )}
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-muted-foreground">Add your notes (optional)</summary>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Paste class notes or a worksheet…" className="mt-2 w-full rounded-lg border bg-background p-3 outline-none focus:ring-2 focus:ring-ring" />
                </details>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    {SAMPLES.map((s) => <button type="button" key={s} onClick={() => start(s)} disabled={!!loading} className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-secondary">{s}</button>)}
                  </div>
                  <button disabled={!topic.trim() || !!loading} className="rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground disabled:opacity-50">Get unstuck</button>
                </div>
              </form>
            </div>
          )}

          {stage === "diagnostic" && diag && (
            <Card kicker="Quick check" why={diag.why}>
              <h2 className="text-2xl font-semibold">{diag.question}</h2>
              <Choices options={diag.options.map((o) => o.text)} picked={picked} onPick={setPicked} />
              <Primary disabled={picked == null || !!loading} onClick={() => { void submitDiag(); }}>Check my answer</Primary>
            </Card>
          )}

          {stage === "diagnosis" && diagnosis && (
            <Card kicker="What might be going on" why="Your answer tells us something. These are our best guesses — not verdicts.">
              <section className="mb-5 rounded-lg bg-secondary p-4">
                <h2 className="font-semibold">What your answers show</h2>
                {diagnosis.demonstrated.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{diagnosis.demonstrated.map((item, i) => <li key={i}>{item}</li>)}</ul>
                ) : <p className="mt-2 text-sm text-muted-foreground">We don't have enough evidence to identify a concept you have demonstrated yet.</p>}
              </section>
              <ul className="space-y-3">
                {diagnosis.hypotheses.filter((h) => !disputed.includes(h.label)).map((h, i) => (
                  <li key={h.label} className={`rounded-lg border p-4 ${i === 0 ? "border-accent bg-accent/10" : ""}`}>
                    <p className="text-lg">{h.summary}</p>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{h.confidence === "high" ? "Fairly likely" : h.confidence === "medium" ? "Possible" : "Just a hunch"}</span>
                      <button onClick={() => { const d = [...disputed, h.label]; setDisputed(d); runDiagnose(followUps, d); }} disabled={!!loading} className="underline underline-offset-2 hover:text-foreground">That's not it</button>
                    </div>
                  </li>
                ))}
              </ul>
              {diagnosis.unresolved.length > 0 && (
                <section className="mt-5 border-t pt-4">
                  <h3 className="text-sm font-semibold">Still uncertain</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{diagnosis.unresolved.map((item, i) => <li key={i}>{item}</li>)}</ul>
                </section>
              )}
              {diagnosis.needsFollowUp && diagnosis.followUp ? (
                <FollowUp fu={diagnosis.followUp} disabled={!!loading} onAnswer={(a) => { const f = [...followUps, { q: diagnosis.followUp!.question, a }]; setFollowUps(f); runDiagnose(f); }} />
              ) : (
                <div className="mt-6">
                  <p className="mb-3 text-sm text-muted-foreground">Here's what we'll try next:</p>
                  <Primary disabled={!!loading} onClick={() => teach(diagnosis.recommendedStyle)}>{STYLES.find((s) => s.id === diagnosis.recommendedStyle)?.label ?? "Teach me"}</Primary>
                </div>
              )}
            </Card>
          )}

          {stage === "lesson" && lesson && (
            <Card kicker={STYLES.find((s) => s.id === lesson.style)?.label ?? "Lesson"} why="Aimed at the difficulty we spotted.">
              <h2 className="text-2xl font-semibold">{lesson.title}</h2>
              <p className="mt-3 whitespace-pre-line leading-relaxed">{lesson.body}</p>
              {lesson.diagram && <pre className="mt-4 overflow-x-auto rounded-lg bg-secondary p-4 font-mono text-sm">{lesson.diagram}</pre>}
              {lesson.steps?.length > 0 && <ol className="mt-4 list-decimal space-y-2 pl-5">{lesson.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
              <LessonTools lesson={lesson} concept={diag?.concept ?? topic} caps={caps} />
              <div className="mt-8 border-t pt-5">
                <Primary disabled={!!loading} onClick={() => getTransfer()}>I think I get it — test me</Primary>
                <p className="mt-5 text-sm font-medium">Still fuzzy? Teach me another way:</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {STYLES.filter((s) => s.id !== lesson.style).map((s) => (
                    <button key={s.id} onClick={() => teach(s.id)} disabled={!!loading} className="rounded-full border px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50">{s.label}{styles.includes(s.id) ? " (again)" : ""}</button>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {stage === "transfer" && transfer && (
            <Card kicker={`New context · ${transfer.context}`} why="Same idea, different situation. No hints this time — that's how we know it stuck.">
              <h2 className="text-2xl font-semibold">{transfer.question}</h2>
              <Choices options={transfer.options} picked={tPick} onPick={setTPick} />
              <Primary disabled={tPick == null || !!loading} onClick={() => { void answerTransfer(); }}>Submit</Primary>
            </Card>
          )}

          {stage === "done" && transfer && (
            <Card kicker="Result" why="">
              {history[history.length - 1]?.correct ? <h2 className="text-3xl font-semibold text-success">Nice — that's right.</h2> : <h2 className="text-3xl font-semibold">Not quite yet.</h2>}
              {transfer.explanation && <p className="mt-3 leading-relaxed">{transfer.explanation}</p>}
              <p className="mt-5 rounded-lg bg-secondary p-4 text-sm"><strong>{status}.</strong>{" "}
                {status === "Demonstrated under current criteria" ? "Two clean answers in different contexts without hints. Come back later to make sure it lasts." : `We look for two correct answers in a row, in different contexts, without hints${usedHint ? " (you used a hint this session — that's fine, it just doesn't count as a clean answer)" : ""}.`}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                {status !== "Demonstrated under current criteria" && <Primary disabled={!!loading} onClick={() => history[history.length - 1]?.correct ? getTransfer() : runDiagnose(followUps)}>{history[history.length - 1]?.correct ? "Try another one" : "Let's figure out why"}</Primary>}
                <button onClick={() => reset()} className="rounded-lg border px-5 py-2.5">Start something new</button>
              </div>
            </Card>
          )}
        </section>
  );
}

function Card({ kicker, why, children }: { kicker: string; why: string; children: React.ReactNode }) {
  return (
    <div className="card-paper animate-in fade-in slide-in-from-bottom-2 p-6 md:p-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">{kicker}</p>
      {why && <p className="mt-1 mb-4 text-sm text-muted-foreground">{why}</p>}
      {children}
    </div>
  );
}

function Choices({ options, picked, onPick }: { options: string[]; picked: number | null; onPick: (i: number) => void }) {
  return (
    <div role="radiogroup" className="my-5 grid gap-2">
      {options.map((o, i) => (
        <button key={i} role="radio" aria-checked={picked === i} onClick={() => onPick(i)} className={`rounded-lg border p-4 text-left transition ${picked === i ? "border-primary bg-primary/5 ring-2 ring-primary" : "hover:bg-secondary"}`}>
          <span className="mr-3 font-mono text-muted-foreground">{String.fromCharCode(65 + i)}</span>{o}
        </button>
      ))}
    </div>
  );
}

function FollowUp({ fu, onAnswer, disabled }: { fu: { question: string; options: string[]; why: string }; onAnswer: (a: string) => void; disabled: boolean }) {
  const [p, setP] = useState<number | null>(null);
  return (
    <div className="mt-6 border-t pt-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">One more question</p>
      <p className="mt-1 text-sm text-muted-foreground">{fu.why}</p>
      <p className="mt-3 text-lg font-medium">{fu.question}</p>
      <Choices options={fu.options} picked={p} onPick={setP} />
      <Primary disabled={p == null || disabled} onClick={() => p != null && onAnswer(fu.options[p] ?? "")}>Continue</Primary>
    </div>
  );
}

function Primary({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className="rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">{children}</button>;
}
