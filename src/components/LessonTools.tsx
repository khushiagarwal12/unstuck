import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";

import { findConceptVideo, speakText, translateLesson } from "@/lib/google.functions";
import { LANGUAGES, type LanguageCode } from "@/lib/languages";

export type Caps = { vision: boolean; speech: boolean; translate: boolean; video: boolean };
type Lesson = { title: string; body: string; steps: string[] };

const KEY = "unstuck:language";
const loadLang = (): LanguageCode => {
  try {
    const v = localStorage.getItem(KEY);
    if (LANGUAGES.some((l) => l.code === v)) return v as LanguageCode;
  } catch { /* storage can be blocked */ }
  return "en";
};

const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Try again.");

/** Read aloud (Cloud Text-to-Speech), translate (Cloud Translation) and a short video (YouTube Data API). */
export function LessonTools({ lesson, concept, caps }: { lesson: Lesson; concept: string; caps: Caps }) {
  const speak = useServerFn(speakText);
  const translate = useServerFn(translateLesson);
  const video = useServerFn(findConceptVideo);
  const [lang, setLang] = useState<LanguageCode>("en");
  const [shown, setShown] = useState<Lesson | null>(null); // translated copy
  const [vid, setVid] = useState<{ id: string; title: string; channel: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState<"speak" | "translate" | "video" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => setLang(loadLang()), []);
  useEffect(() => { setShown(null); setVid(undefined); setErr(null); audio.current?.pause(); }, [lesson]);

  if (!caps.speech && !caps.translate && !caps.video) return null;

  const pickLang = (code: LanguageCode) => {
    setLang(code); setShown(null);
    try { localStorage.setItem(KEY, code); } catch { /* ignore */ }
  };

  const doTranslate = async () => {
    setBusy("translate"); setErr(null);
    try {
      const { texts } = await translate({ data: { texts: [lesson.title, lesson.body, ...lesson.steps], language: lang } });
      setShown({ title: texts[0] ?? lesson.title, body: texts[1] ?? lesson.body, steps: texts.slice(2) });
    } catch (e) { setErr(msg(e)); } finally { setBusy(null); }
  };

  const doSpeak = async () => {
    setBusy("speak"); setErr(null);
    const src = shown ?? lesson;
    const text = [src.title, src.body, ...src.steps.map((s, i) => `${i + 1}. ${s}`)].join(". ").slice(0, 4500);
    try {
      const { audio: b64 } = await speak({ data: { text, language: lang } });
      audio.current?.pause();
      audio.current = new Audio(`data:audio/mp3;base64,${b64}`);
      await audio.current.play();
    } catch (e) { setErr(msg(e)); } finally { setBusy(null); }
  };

  const doVideo = async () => {
    setBusy("video"); setErr(null);
    try { setVid((await video({ data: { concept, language: lang } })).video); }
    catch (e) { setErr(msg(e)); } finally { setBusy(null); }
  };

  const btn = "rounded-full border px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50";
  return (
    <div className="mt-6 rounded-lg border p-4" aria-label="Listen, translate or watch">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="lesson-lang">Language</label>
        <select id="lesson-lang" value={lang} onChange={(e) => pickLang(e.target.value as LanguageCode)} className="rounded-full border bg-background px-3 py-1.5 text-sm">
          {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        {caps.translate && lang !== "en" && <button className={btn} disabled={busy !== null} onClick={doTranslate}>{busy === "translate" ? "Translating…" : "Translate"}</button>}
        {caps.speech && <button className={btn} disabled={busy !== null} onClick={doSpeak}>{busy === "speak" ? "Preparing audio…" : "Listen"}</button>}
        {caps.video && <button className={btn} disabled={busy !== null} onClick={doVideo}>{busy === "video" ? "Searching…" : "Watch a short video"}</button>}
      </div>
      {err && <p role="alert" className="mt-3 text-sm text-destructive">{err}</p>}
      {shown && (
        <div className="mt-4 border-t pt-4">
          <p className="font-medium">{shown.title}</p>
          <p className="mt-2 whitespace-pre-line leading-relaxed">{shown.body}</p>
          {shown.steps.length > 0 && <ol className="mt-3 list-decimal space-y-1 pl-5">{shown.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
          <p className="mt-2 text-xs text-muted-foreground">Translated with Google Translate.</p>
        </div>
      )}
      {vid === null && <p className="mt-3 text-sm text-muted-foreground">No suitable video found for this topic.</p>}
      {vid && (
        <figure className="mt-4">
          <div className="aspect-video overflow-hidden rounded-lg border">
            <iframe className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${vid.id}`} title={vid.title} loading="lazy" allow="encrypted-media; picture-in-picture" allowFullScreen />
          </div>
          <figcaption className="mt-1 text-xs text-muted-foreground">{vid.title}{vid.channel ? ` · ${vid.channel}` : ""} (YouTube)</figcaption>
        </figure>
      )}
    </div>
  );
}
