import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { askTutor } from "@/lib/tutor.functions";
import { courseSchema, type CoursePlan } from "@/lib/tutor-schemas";
import { getCapabilities, readProblem } from "@/lib/google.functions";
import { shrinkImage } from "@/lib/image";
import { importGuestProgress } from "@/lib/progress.functions";
import { appendGuestProgress, clearGuestProgress, GUEST_PROGRESS_KEY, readGuestProgress, type GuestProgressBundle } from "@/lib/guest-progress";
import { adoptGuestSession } from "@/lib/session-storage";
import { CoachCard } from "@/components/CoachCard";
import { LearnSession, type SessionRecord } from "@/components/LearnSession";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "UNSTUCK — Understand what you don't understand" },
      { name: "description", content: "A personal learning companion that diagnoses why you're stuck, teaches another way, and checks you can apply it yourself." },
      { property: "og:title", content: "UNSTUCK — Understand what you don't understand" },
      { property: "og:description", content: "Diagnose before prescribing. Teach another way. Verify real understanding." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Profile = { id: string; display_name: string | null; avatar_url: string | null; goal: string | null; subject: string | null; level: string | null; study_minutes: number | null; preferred_styles: string[]; onboarded: boolean };
type Concept = { id: string; concept: string; status: string; misconceptions: string[]; styles: string[]; hints_used: number; attempts: number; clean_successes: number; review_interval_days: number; review_at: string | null; last_explanation: string | null; updated_at: string };
type Topic = { id: string; name: string; why: string; prerequisites: string[]; minutes: number };
type Course = { id: string; title: string; goal: string | null; outcomes: string[]; topics: Topic[]; plan: CoursePlan | null; created_at: string };
type CourseProgress = {
  user_id: string;
  course_id: string;
  current_phase_id: string | null;
  current_topic_id: string | null;
  completed_topic_ids: string[];
  completed_phase_ids: string[];
  assessment_responses: Record<string, string>;
  updated_at: string;
};
type CourseProgressPatch = Partial<Omit<CourseProgress, "user_id" | "course_id" | "updated_at">>;

type View = { kind: "home" } | { kind: "learn"; topic?: string; key: number } | { kind: "settings" };

const STYLE_OPTIONS = [
  { id: "visual", label: "Pictures & diagrams" },
  { id: "example", label: "Worked examples" },
  { id: "simpler", label: "Short, simple explanations" },
  { id: "analogy", label: "Real-world analogies" },
];

function Index() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [trial, setTrial] = useState(false);
  const [guestProgress, setGuestProgress] = useState<GuestProgressBundle | null>(null);
  const [guestSaveError, setGuestSaveError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  useEffect(() => {
    let hadUser = false;
    let receivedAuthEvent = false;
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      receivedAuthEvent = true;
      if (session?.user) {
        hadUser = true;
        setAuthNotice(null);
        try { adoptGuestSession(window.localStorage, session.user.id); } catch {
          setAuthNotice("Your guest session is still saved on this device, but we couldn't move it into your account automatically.");
        }
      } else if (hadUser) {
        setAuthNotice("Your sign-in session ended. Continue with Google to reopen your learning workspace.");
        hadUser = false;
      }
      setUser(session?.user ?? null);
      setAuthReady(true);
    });
    supabase.auth.getUser().then(({ data, error }) => {
      if (receivedAuthEvent) return;
      setUser(data.user ?? null);
      hadUser = !!data.user;
      if (error) setAuthNotice("We couldn't confirm your sign-in. Please try Google sign-in again.");
      setAuthReady(true);
    }).catch(() => {
      if (receivedAuthEvent) return;
      setAuthNotice("We couldn't confirm your sign-in. Please check your connection and try Google sign-in again.");
      setAuthReady(true);
    });
    try {
      setGuestProgress(readGuestProgress(window.localStorage));
    } catch {
      setGuestSaveError("We couldn't read saved guest progress on this device. It has not been deleted.");
    }
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!authReady) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!user && trial) return (
    <Shell right={<SignInButton small />}>
      <div className="mb-6 rounded-lg bg-secondary p-4 text-sm">You're using UNSTUCK as a guest. Your completed progress is saved on this device. <strong>Continue with Google</strong> to bring it to your learning workspace.{guestProgress?.events.length ? ` ${guestProgress.events.length} completed learning ${guestProgress.events.length === 1 ? "attempt is" : "attempts are"} saved.` : ""}</div>
      {authNotice && <p role="alert" className="mb-4 text-sm text-destructive">{authNotice}</p>}
      {guestSaveError && <p role="alert" className="mb-4 text-sm text-destructive">{guestSaveError}</p>}
      <LearnSession storageKey="unstuck.guest-session.v1" onRecord={(r) => {
        try {
          const current = guestProgress ?? readGuestProgress(window.localStorage);
          const next = appendGuestProgress(current, r);
          window.localStorage.setItem(GUEST_PROGRESS_KEY, JSON.stringify(next));
          setGuestProgress(next);
          setGuestSaveError(null);
        } catch {
          setGuestSaveError("This attempt couldn't be saved on this device. Please allow local storage and try again.");
        }
      }} onExit={() => setTrial(false)} />
    </Shell>
  );
  if (!user) return <Welcome onTry={() => setTrial(true)} authNotice={authNotice} />;
  return <SignedIn user={user} onGuestImport={() => setGuestProgress(null)} />;
}

function Shell({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-6">
        <span className="font-display text-2xl font-semibold tracking-tight">UNSTUCK<span className="text-accent">.</span></span>
        {right}
      </header>
      <main className="mx-auto max-w-5xl px-6 pb-20">{children}</main>
    </div>
  );
}

function SignInButton({ small }: { small?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
      if (r.error) { setErr("Google sign-in didn't finish. Please try again."); setBusy(false); return; }
      if (!r.redirected) setBusy(false);
    } catch {
      setErr("Google sign-in couldn't be started. Check your connection and try again.");
      setBusy(false);
    }
  };
  return (
    <div className={small ? "" : "flex flex-col items-start gap-2"}>
      <button onClick={go} disabled={busy} className={`inline-flex items-center gap-3 rounded-lg border bg-card font-medium shadow-sm transition hover:bg-secondary disabled:opacity-60 ${small ? "px-3 py-1.5 text-sm" : "px-5 py-3"}`}>
        <GoogleMark />{busy ? "Opening Google…" : "Continue with Google"}
      </button>
      {err && <span role="alert" className="text-sm text-destructive">{err}</span>}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function Welcome({ onTry, authNotice }: { onTry: () => void; authNotice?: string | null }) {
  const [authError, setAuthError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (error) setAuthError(error === "access_denied" ? "Google sign-in was cancelled. You can try again or continue as a guest." : "Google sign-in couldn't be completed. Please try again or continue as a guest.");
  }, []);
  return (
    <Shell>
      <section className="grid gap-12 pt-10 md:grid-cols-[1.3fr_1fr] md:items-center">
        <div>
          <h1 className="text-5xl font-semibold leading-[1.05] md:text-6xl">Understand what you <em className="text-accent">don't</em> understand.</h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">UNSTUCK finds why a concept isn't clicking, teaches it a different way, and checks you can use it on your own — then remembers what you've learned.</p>
          {(authError || authNotice) && <p role="alert" className="mt-4 text-sm text-destructive">{authError || authNotice}</p>}
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <SignInButton />
            <button onClick={onTry} className="rounded-lg border px-5 py-3 font-medium hover:bg-secondary">Continue as Guest</button>
          </div>
        </div>
        <ol className="card-paper space-y-4 p-6 text-sm">
          {[["Check", "A quick question to see where you are."], ["Diagnose", "A best guess at what's tripping you up — you can disagree."], ["Teach", "A new explanation. Not clicking? Teach me another way."], ["Verify", "A fresh problem in a new situation, no hints."]].map(([t, d], i) => (
            <li key={t} className="flex gap-4"><span className="font-display text-2xl text-accent">{i + 1}</span><span><strong className="block">{t}</strong><span className="text-muted-foreground">{d}</span></span></li>
          ))}
        </ol>
      </section>
    </Shell>
  );
}

function SignedIn({ user, onGuestImport }: { user: User; onGuestImport: () => void }) {
  const ask = useServerFn(askTutor);
  const importProgress = useServerFn(importGuestProgress);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseProgress, setCourseProgress] = useState<Record<string, CourseProgress>>({});
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [view, setView] = useState<View>({ kind: "home" });
  const [menu, setMenu] = useState(false);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const guest = readGuestProgress(window.localStorage);
      if (guest.events.length > 0) {
        await importProgress({ data: { conversionId: guest.conversionId, events: guest.events } });
        clearGuestProgress(window.localStorage, guest.conversionId, guest.events.map((event) => event.id));
        onGuestImport();
      }
    } catch (error) {
      setLoadErr(error instanceof Error ? error.message : "We couldn't safely import your guest progress. It is still saved on this device.");
      return;
    }
    const [p, c, k, cp] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("concepts").select("*").order("updated_at", { ascending: false }),
      supabase.from("courses").select("*").order("created_at", { ascending: false }),
      supabase.from("course_progress").select("*"),
    ]);
    if (p.error || c.error || k.error || cp.error) { setLoadErr("We couldn't load your learning profile."); return; }
    let prof = p.data as Profile | null;
    if (!prof) {
      const ins = await supabase.from("profiles").insert({ id: user.id, display_name: (user.user_metadata?.full_name as string) ?? null, avatar_url: (user.user_metadata?.avatar_url as string) ?? null }).select().single();
      prof = ins.data as Profile | null;
    }
    setProfile(prof);
    setConcepts((c.data ?? []) as Concept[]);
    const parsedCourses: Course[] = [];
    for (const row of k.data ?? []) {
      let plan: CoursePlan | null = null;
      if (row.plan) {
        const parsed = courseSchema.safeParse(row.plan);
        if (parsed.success) plan = parsed.data;
      }
      parsedCourses.push({ ...row, plan, topics: (row.topics ?? []) as unknown as Topic[] } as Course);
    }
    setCourses(parsedCourses);
    setCourseProgress(Object.fromEntries((cp.data ?? []).map((row) => [row.course_id, {
      ...row,
      assessment_responses: (row.assessment_responses ?? {}) as Record<string, string>,
    } as CourseProgress])));
  }, [user, importProgress, onGuestImport]);
  useEffect(() => { load(); }, [load]);

  const prefs = profile ? { goal: profile.goal, subject: profile.subject, selfReportedLevel: profile.level, studyMinutesPerSession: profile.study_minutes, preferredStyles: profile.preferred_styles } : undefined;

  const record = async (r: SessionRecord) => {
    const prev = concepts.find((c) => c.concept.toLowerCase() === r.concept.toLowerCase());
    const interval = r.clean ? Math.min((prev?.review_interval_days ?? 1) * 2, 30) : 1;
    const row = {
      user_id: user.id,
      concept: prev?.concept ?? r.concept,
      status: r.status,
      misconceptions: r.misconceptions.length ? r.misconceptions : prev?.misconceptions ?? [],
      styles: Array.from(new Set([...(prev?.styles ?? []), ...r.styles])),
      hints_used: (prev?.hints_used ?? 0) + r.hintsUsed,
      attempts: (prev?.attempts ?? 0) + 1,
      clean_successes: (prev?.clean_successes ?? 0) + (r.clean ? 1 : 0),
      review_interval_days: interval,
      review_at: new Date(Date.now() + interval * 86400000).toISOString(),
      last_explanation: r.explanation ?? prev?.last_explanation ?? null,
      updated_at: new Date().toISOString(),
    };

    const { data } = await supabase.from("concepts").upsert(row, { onConflict: "user_id,concept" }).select().single();
    if (data) setConcepts((cs) => [data as Concept, ...cs.filter((c) => c.id !== (data as Concept).id)]);
  };

  const saveCourseProgress = async (courseId: string, patch: CourseProgressPatch) => {
    const previous = courseProgress[courseId];
    const next = {
      user_id: user.id,
      course_id: courseId,
      current_phase_id: previous?.current_phase_id ?? null,
      current_topic_id: previous?.current_topic_id ?? null,
      completed_topic_ids: previous?.completed_topic_ids ?? [],
      completed_phase_ids: previous?.completed_phase_ids ?? [],
      assessment_responses: previous?.assessment_responses ?? {},
      ...patch,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from("course_progress").upsert(next, { onConflict: "user_id,course_id" }).select().single();
    if (error || !data) throw new Error("Couldn't save your course progress. Your existing progress is unchanged.");
    const saved = { ...data, assessment_responses: data.assessment_responses as Record<string, string> } as CourseProgress;
    setCourseProgress((current) => ({ ...current, [courseId]: saved }));
    return saved;
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut();
      setAuthError(error ? "We couldn't sign you out. Please try again." : null);
    } catch {
      setAuthError("We couldn't sign you out. Please check your connection and try again.");
    } finally {
      setSigningOut(false);
    }
  };

  const right = (
    <div className="relative">
      <button onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label="Account menu" className="flex items-center gap-2 rounded-full border bg-card p-1 pr-3 text-sm">
        {profile?.avatar_url ? <img src={profile.avatar_url} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" /> : <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground">{(profile?.display_name ?? user.email ?? "?")[0]}</span>}
        <span className="hidden sm:inline">{profile?.display_name?.split(" ")[0] ?? "Account"}</span>
      </button>
      {menu && (
        <div className="card-paper absolute right-0 z-10 mt-2 w-56 p-2 text-sm">
          <p className="truncate px-3 py-2 text-muted-foreground">{user.email}</p>
          {authError && <p role="alert" className="px-3 py-2 text-destructive">{authError}</p>}
          <button className="block w-full rounded-md px-3 py-2 text-left hover:bg-secondary" onClick={() => { setView({ kind: "home" }); setMenu(false); }}>Dashboard</button>
          <button className="block w-full rounded-md px-3 py-2 text-left hover:bg-secondary" onClick={() => { setView({ kind: "settings" }); setMenu(false); }}>Learning preferences</button>
          <button className="block w-full rounded-md px-3 py-2 text-left hover:bg-secondary disabled:opacity-50" onClick={signOut} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button>
        </div>
      )}
    </div>
  );

  if (loadErr) return <Shell right={right}><div role="alert" className="flex items-center gap-4"><span>{loadErr}</span><button onClick={load} className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground">Retry</button></div></Shell>;
  if (!profile) return <Shell right={right}><p className="text-muted-foreground">Loading your profile…</p></Shell>;
  if (!profile.onboarded || view.kind === "settings") return (
    <Shell right={right}>
      <Onboarding profile={profile} editing={profile.onboarded} onDone={async (p, next) => { setProfile(p); if (next) setView({ kind: "learn", topic: next, key: Date.now() }); else setView({ kind: "home" }); }} />
    </Shell>
  );
  if (view.kind === "learn") return (
    <Shell right={right}>
      <button onClick={() => setView({ kind: "home" })} className="mb-4 text-sm text-muted-foreground hover:text-foreground">← Back to dashboard</button>
      <LearnSession key={view.key} storageKey={`unstuck.user-session.v1:${user.id}`} initialTopic={view.topic} prefs={prefs} onRecord={record} onExit={() => setView({ kind: "home" })} />
    </Shell>
  );
  return (
    <Shell right={right}>
      <Dashboard profile={profile} concepts={concepts} courses={courses} courseProgress={courseProgress} saveCourseProgress={saveCourseProgress} ask={ask} prefs={prefs} setCourses={setCourses} userId={user.id}
        learn={(topic) => setView({ kind: "learn", topic, key: Date.now() })}
        dismiss={async (c) => { const at = new Date(Date.now() + 7 * 86400000).toISOString(); await supabase.from("concepts").update({ review_at: at }).eq("id", c.id); setConcepts((cs) => cs.map((x) => x.id === c.id ? { ...x, review_at: at } : x)); }}
      />
    </Shell>
  );
}

function Onboarding({ profile, editing, onDone }: { profile: Profile; editing: boolean; onDone: (p: Profile, next?: string) => void }) {
  const [goal, setGoal] = useState(profile.goal ?? "");
  const [subject, setSubject] = useState(profile.subject ?? "");
  const [level, setLevel] = useState(profile.level ?? "");
  const [minutes, setMinutes] = useState(profile.study_minutes ?? 20);
  const [styles, setStyles] = useState<string[]>(profile.preferred_styles ?? []);
  const [stuck, setStuck] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (skip = false) => {
    setSaving(true); setErr(null);
    const patch = skip ? { onboarded: true } : { goal: goal || null, subject: subject || null, level: level || null, study_minutes: minutes, preferred_styles: styles, onboarded: true, updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from("profiles").update(patch).eq("id", profile.id).select().single();
    setSaving(false);
    if (error || !data) { setErr("Couldn't save. Please try again."); return; }
    onDone(data as Profile, !skip && stuck.trim() ? stuck.trim() : undefined);
  };

  const input = "mt-2 w-full rounded-lg border bg-background p-3 outline-none focus:ring-2 focus:ring-ring";
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-4xl font-semibold">{editing ? "Your learning preferences" : `Welcome${profile.display_name ? `, ${profile.display_name.split(" ")[0]}` : ""}.`}</h1>
      <p className="mt-2 text-muted-foreground">{editing ? "Change anything, any time." : "A few quick questions so we can start in the right place. Everything is optional."}</p>
      <form className="card-paper mt-8 space-y-6 p-6" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="block text-sm font-medium">What do you want to learn?
          <input className={input} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Class 10 algebra, intro physics, statistics" />
        </label>
        <label className="block text-sm font-medium">What are you working toward?
          <input className={input} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. Board exam in March, understand it properly" />
        </label>
        <fieldset>
          <legend className="text-sm font-medium">How comfortable do you feel with it?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {["Just starting", "Somewhat comfortable", "Pretty confident"].map((l) => (
              <button type="button" key={l} onClick={() => setLevel(l)} aria-pressed={level === l} className={`rounded-full border px-4 py-1.5 text-sm ${level === l ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>{l}</button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Just a starting point — we'll adjust based on how you actually do.</p>
        </fieldset>
        <label className="block text-sm font-medium">Time per session: <span className="text-accent">{minutes} min</span>
          <input type="range" min={5} max={60} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="mt-2 w-full accent-[var(--accent)]" />
        </label>
        <fieldset>
          <legend className="text-sm font-medium">How do you like things explained?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {STYLE_OPTIONS.map((s) => {
              const on = styles.includes(s.id);
              return <button type="button" key={s.id} aria-pressed={on} onClick={() => setStyles((x) => on ? x.filter((y) => y !== s.id) : [...x, s.id])} className={`rounded-full border px-4 py-1.5 text-sm ${on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>{s.label}</button>;
            })}
          </div>
        </fieldset>
        {!editing && (
          <label className="block text-sm font-medium">Stuck on something right now? <span className="font-normal text-muted-foreground">(we'll start there)</span>
            <textarea className={input} rows={2} value={stuck} onChange={(e) => setStuck(e.target.value)} placeholder="A question, a concept, or a mistake you keep making" />
          </label>
        )}
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        <div className="flex flex-wrap items-center gap-4">
          <button disabled={saving} className="rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground disabled:opacity-50">{saving ? "Saving…" : editing ? "Save" : stuck.trim() ? "Save & get unstuck" : "Save & continue"}</button>
          {!editing && <button type="button" onClick={() => save(true)} disabled={saving} className="text-sm text-muted-foreground underline">Skip for now</button>}
        </div>
      </form>
    </div>
  );
}

const statusGroup = (s: string) => s.startsWith("Demonstrated") ? "done" : s === "Progressing" ? "developing" : "work";

function Dashboard({ profile, concepts, courses, courseProgress, saveCourseProgress, ask, prefs, setCourses, userId, learn, dismiss }: {
  profile: Profile; concepts: Concept[]; courses: Course[]; courseProgress: Record<string, CourseProgress>;
  saveCourseProgress: (courseId: string, patch: CourseProgressPatch) => Promise<CourseProgress>;
  ask: ReturnType<typeof useServerFn<typeof askTutor>>; prefs: Record<string, unknown> | undefined;
  setCourses: React.Dispatch<React.SetStateAction<Course[]>>; userId: string; learn: (t?: string) => void; dismiss: (c: Concept) => void;
}) {
  const readPhoto = useServerFn(readProblem);
  const capabilities = useServerFn(getCapabilities);
  const [creating, setCreating] = useState(false);
  const [reading, setReading] = useState(false);
  const [visionAvailable, setVisionAvailable] = useState(false);
  const [courseGoal, setCourseGoal] = useState(profile.subject ?? "");
  const [courseMaterial, setCourseMaterial] = useState("");
  const [draft, setDraft] = useState<CoursePlan | null>(null);
  const [activeCourseId, setActiveCourseId] = useState(courses[0]?.id ?? "");
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [assessmentDraft, setAssessmentDraft] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [openExplanation, setOpenExplanation] = useState<string | null>(null);
  const course = courses.find((c) => c.id === activeCourseId) ?? courses[0];
  const plan = course?.plan ?? null;
  const progress = course ? courseProgress[course.id] : undefined;
  const byName = new Map(concepts.map((c) => [c.concept.toLowerCase(), c]));
  const needsDiagnostic = concepts.length === 0;
  const due = concepts.filter((c) => c.review_at && new Date(c.review_at) <= new Date());
  const work = concepts.filter((c) => statusGroup(c.status) === "work");
  const topicEntries = plan?.phases.flatMap((phase) => phase.topics.map((topic) => ({ phase, topic }))) ?? [];
  const completedTopicIds = new Set(progress?.completed_topic_ids ?? []);
  const completedPhaseIds = new Set(progress?.completed_phase_ids ?? []);
  const openPhase = plan?.phases.find((phase) => !completedPhaseIds.has(phase.id));
  const firstOpenTopic = openPhase?.topics.find((topic) => !completedTopicIds.has(topic.id));
  const firstOpenEntry = topicEntries.find(({ phase, topic }) => phase.id === openPhase?.id && topic.id === firstOpenTopic?.id);
  const currentEntry = topicEntries.find(({ phase, topic }) => phase.id === openPhase?.id && topic.id === activeTopicId)
    ?? topicEntries.find(({ phase, topic }) => phase.id === openPhase?.id && topic.id === progress?.current_topic_id)
    ?? firstOpenEntry;
  const nextTopic = currentEntry?.topic;
  const last = concepts[0];
  const away = last ? (Date.now() - new Date(last.updated_at).getTime()) / 86400000 : 0;

  useEffect(() => {
    capabilities().then((result) => setVisionAvailable(result.vision)).catch(() => setVisionAvailable(false));
  }, [capabilities]);

  const makeCourse = async () => {
    if (!courseGoal.trim() || creating) return;
    if (needsDiagnostic) { setErr("Complete one diagnostic and practice attempt first so your plan starts from demonstrated knowledge."); return; }
    setCreating(true); setErr(null); setDraft(null);
    try {
      const diagnosticResults = concepts.slice(0, 12).map((c) => ({
        concept: c.concept.slice(0, 120), status: c.status.slice(0, 80), attempts: c.attempts,
        cleanSuccesses: c.clean_successes, hintsUsed: c.hints_used,
        misconceptions: c.misconceptions.slice(0, 2).map((item) => item.slice(0, 180)),
        lastExplanation: c.last_explanation?.slice(0, 500) ?? null,
      }));
      const { json } = await ask({ data: { action: "course", payload: {
        wantsToLearn: courseGoal.trim(),
        ...prefs,
        diagnosticResults,
        prerequisiteGaps: concepts.filter((c) => statusGroup(c.status) !== "done").slice(0, 24).map((c) => c.concept.slice(0, 120)),
        alreadyDemonstrated: concepts.filter((c) => statusGroup(c.status) === "done").slice(0, 24).map((c) => c.concept.slice(0, 120)),
        learningMaterial: courseMaterial.trim().slice(0, 6000) || null,
      } } });
      const parsed = courseSchema.safeParse(JSON.parse(json));
      if (!parsed.success) throw new Error("The generated course plan did not match the required structure. Please try again.");
      setDraft(parsed.data);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't build a course."); }
    finally { setCreating(false); }
  };

  const saveDraft = async () => {
    if (!draft) return;
    setCreating(true); setErr(null);
    const topics = draft.phases.flatMap((phase) => phase.topics.map((topic) => ({
      id: topic.id, name: topic.name, why: topic.why, prerequisites: topic.prerequisites, minutes: topic.minutes,
    })));
    const { data, error } = await supabase.from("courses").insert({
      user_id: userId, title: draft.title, goal: draft.goal, outcomes: draft.outcomes, topics, plan: draft,
    }).select().single();
    if (error || !data) { setErr("Couldn't save the plan. The proposed plan is still available to review."); setCreating(false); return; }
    const savedCourse = { ...data, plan: draft, topics } as unknown as Course;
    setCourses((current) => [savedCourse, ...current]);
    setActiveCourseId(savedCourse.id);
    setDraft(null);
    const first = draft.phases[0]?.topics[0];
    if (first) {
      try {
        await saveCourseProgress(savedCourse.id, { current_phase_id: draft.phases[0]!.id, current_topic_id: first.id });
        setActiveTopicId(first.id);
        await startCourse(savedCourse);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "The course was saved, but its starting position couldn't be saved.");
      }
    }
    setCreating(false);
  };

  const hasDemonstratedCover = (topic: CoursePlan["phases"][number]["topics"][number]) =>
    topic.covers.length > 0 && topic.covers.every((name) => {
      const record = byName.get(name.toLowerCase());
      return record?.status.startsWith("Demonstrated") === true && record.clean_successes >= 2;
    });

  async function startCourse(selected: Course) {
    if (!selected.plan) return;
    const entries = selected.plan.phases.flatMap((phase) => phase.topics.map((topic) => ({ phase, topic })));
    const covered = entries.filter(({ topic }) => hasDemonstratedCover(topic)).map(({ topic }) => topic.id);
    const previous = courseProgress[selected.id];
    const completed = Array.from(new Set([...(previous?.completed_topic_ids ?? []), ...covered]));
    const completedPhases = new Set(previous?.completed_phase_ids ?? []);
    const openPhase = selected.plan.phases.find((phase) => !completedPhases.has(phase.id));
    const savedPosition = entries.find(({ phase, topic }) => phase.id === openPhase?.id && topic.id === previous?.current_topic_id && !completed.includes(topic.id));
    const next = savedPosition ?? openPhase?.topics.find((topic) => !completed.includes(topic.id));
    const nextPhaseId = openPhase?.id ?? null;
    try {
      await saveCourseProgress(selected.id, {
        completed_topic_ids: completed,
        current_phase_id: nextPhaseId,
        current_topic_id: next?.id ?? null,
      });
      setActiveCourseId(selected.id);
      setActiveTopicId(next?.id ?? null);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save your course position."); }
  }

  const selectTopic = async (phaseId: string, topicId: string) => {
    if (!course) return;
    try {
      await saveCourseProgress(course.id, { current_phase_id: phaseId, current_topic_id: topicId });
      setActiveTopicId(topicId);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save your course position."); }
  };

  const completeTopic = async () => {
    if (!course || !plan || !currentEntry) return;
    const completed = Array.from(new Set([...(progress?.completed_topic_ids ?? []), currentEntry.topic.id]));
    const openPhase = plan.phases.find((phase) => !completedPhaseIds.has(phase.id));
    const next = openPhase?.topics.find((topic) => !completed.includes(topic.id));
    try {
      await saveCourseProgress(course.id, {
        completed_topic_ids: completed,
        current_phase_id: openPhase?.id ?? null,
        current_topic_id: next?.id ?? null,
      });
      setActiveTopicId(next?.id ?? null);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save your course progress."); }
  };

  const submitAssessment = async (phase: CoursePlan["phases"][number]) => {
    if (!course) return;
    const responses = { ...(progress?.assessment_responses ?? {}) };
    phase.assessment.tasks.forEach((_, index) => {
      responses[`${phase.id}:${index}`] = assessmentDraft[`${phase.id}:${index}`] ?? responses[`${phase.id}:${index}`] ?? "";
    });
    const completedPhases = Array.from(new Set([...(progress?.completed_phase_ids ?? []), phase.id]));
    const nextPhase = plan?.phases.find((item) => !completedPhases.includes(item.id));
    const next = nextPhase?.topics.find((topic) => !completedTopicIds.has(topic.id));
    try {
      await saveCourseProgress(course.id, {
        assessment_responses: responses,
        completed_phase_ids: completedPhases,
        current_phase_id: nextPhase?.id ?? null,
        current_topic_id: next?.id ?? null,
      });
      setActiveTopicId(next?.id ?? null);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save your assessment."); }
  };

  const readMaterialPhoto = async (file: File) => {
    setReading(true); setErr(null);
    try {
      const image = await shrinkImage(file);
      const result = await readPhoto({ data: image });
      setCourseMaterial((current) => [current.trim(), result.text].filter(Boolean).join("\n\n").slice(0, 6000));
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't read that study material."); }
    finally { setReading(false); }
  };

  const nextAction = due[0] ? { label: `Quick recall: ${due[0].concept}`, why: away > 3 ? "Welcome back — a short recap before moving on." : "It's time to check this one stuck.", go: () => learn(due[0]!.concept) }
    : nextTopic && course ? { label: `Next in your course: ${nextTopic.name}`, why: nextTopic.why, go: () => { if (currentEntry) void selectTopic(currentEntry.phase.id, nextTopic.id); } }
    : work[0] ? { label: `Keep working on: ${work[0].concept}`, why: "This one still needs practice.", go: () => learn(work[0]!.concept) }
    : { label: "Get unstuck on something new", why: "Bring a question or concept that's bugging you.", go: () => learn() };

  return (
    <div className="space-y-8">
      <section className="card-paper flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between md:p-8">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-accent">What to do next</p><h1 className="mt-1 text-3xl font-semibold">{nextAction.label}</h1><p className="mt-1 text-muted-foreground">{nextAction.why}</p></div>
        <div className="flex flex-wrap gap-3"><button onClick={nextAction.go} className="rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground">Start</button><button onClick={() => learn()} className="rounded-lg border px-5 py-2.5">I'm stuck on something else</button></div>
      </section>

      <CoachCard userId={userId} firstName={profile.display_name?.split(" ")[0] ?? null} prefs={prefs} concepts={concepts} dueCount={due.length} daysAway={away} />

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <section className="card-paper space-y-5 p-6">
          <div>
            <h2 className="text-xl font-semibold">Your learning journey</h2>
            <p className="mt-1 text-sm text-muted-foreground">A course is saved as a new plan, so revising never overwrites completed work.</p>
          </div>
          {courses.length > 0 && (
            <label className="block text-sm font-medium">Saved plans
              <select className="mt-2 w-full rounded-lg border bg-background p-2" value={course?.id ?? ""} onChange={(event) => { setActiveCourseId(event.target.value); setActiveTopicId(null); }}>
                {courses.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </label>
          )}
          {course && plan ? (
            <div className="rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="text-lg font-semibold">{course.title}</h3><p className="text-sm text-muted-foreground">{course.goal}</p></div>
                <button onClick={() => void startCourse(course)} className="rounded-md bg-secondary px-3 py-1.5 text-sm">Resume course</button>
              </div>
              <ul className="mt-3 flex flex-wrap gap-2">{plan.outcomes.map((outcome) => <li key={outcome} className="rounded-full bg-secondary px-3 py-1 text-xs">{outcome}</li>)}</ul>
              <div className="mt-5 space-y-5">
                {plan.phases.map((phase, phaseIndex) => {
                  const phaseUnlocked = plan.phases.slice(0, phaseIndex).every((previousPhase) => completedPhaseIds.has(previousPhase.id));
                  return (
                  <section key={phase.id} className="border-l-2 pl-4">
                    <div className="flex items-start justify-between gap-2"><div><h4 className="font-semibold">Phase {phaseIndex + 1}: {phase.title}</h4><p className="text-sm text-muted-foreground">{phase.purpose}</p></div><span className="text-xs text-muted-foreground">{progress?.completed_phase_ids.includes(phase.id) ? "Assessment complete" : "In progress"}</span></div>
                    <ol className="mt-3 space-y-2">
                      {phase.topics.map((topic, index) => {
                        const done = completedTopicIds.has(topic.id);
                        const demonstrated = hasDemonstratedCover(topic);
                        const prerequisitesDone = topic.prerequisites.every((id) => {
                          if (completedTopicIds.has(id)) return true;
                          const prerequisite = topicEntries.find((entry) => entry.topic.id === id)?.topic;
                          return prerequisite ? hasDemonstratedCover(prerequisite) : false;
                        });
                        return <li key={topic.id} className="rounded-lg border p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0"><p className="font-medium">{index + 1}. {topic.name}{done && <span className="ml-2 text-xs text-success">Complete</span>}{demonstrated && !done && <span className="ml-2 text-xs text-accent">Already demonstrated</span>}</p><p className="text-xs text-muted-foreground">{topic.why} · ~{topic.minutes} min</p><p className="mt-1 text-xs text-muted-foreground">Objectives: {topic.objectives.join(" · ")}</p><p className="mt-1 text-xs text-muted-foreground">Subtopics: {topic.subtopics.map((item) => item.name).join(" · ")}</p>{topic.prerequisites.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Builds on: {topic.prerequisites.map((id) => phase.topics.find((candidate) => candidate.id === id)?.name ?? topicEntries.find((entry) => entry.topic.id === id)?.topic.name ?? id).join(", ")}</p>}</div>
                            <button disabled={!done && (!phaseUnlocked || !prerequisitesDone)} onClick={() => void selectTopic(phase.id, topic.id)} className="shrink-0 rounded-md bg-secondary px-3 py-1.5 text-sm disabled:opacity-50">{done ? "Review" : !phaseUnlocked ? "Finish prior phase" : prerequisitesDone ? "Open" : "Prerequisite first"}</button>
                          </div>
                          {activeTopicId === topic.id && (
                            <div className="mt-4 space-y-4 border-t pt-4">
                              <p className="whitespace-pre-line text-sm">{topic.lesson.explanation}</p>
                              <div><h5 className="font-medium">Worked examples</h5>{topic.lesson.examples.map((example) => <div key={example.prompt} className="mt-2 rounded-md bg-secondary p-3 text-sm"><p className="font-medium">{example.prompt}</p><p className="mt-1 whitespace-pre-line">{example.walkthrough}</p></div>)}</div>
                              <div><h5 className="font-medium">Guided practice</h5>{topic.lesson.guidedPractice.map((practice) => <details key={practice.prompt} className="mt-2 rounded-md border p-3 text-sm"><summary className="cursor-pointer">{practice.prompt}</summary><p className="mt-2"><strong>Hint:</strong> {practice.hint}</p><p className="mt-1 text-muted-foreground"><strong>Success criteria:</strong> {practice.successCriteria}</p></details>)}</div>
                              <button onClick={() => void completeTopic()} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Mark practice complete</button>
                            </div>
                          )}
                        </li>;
                      })}
                    </ol>
                    <details className="mt-3 rounded-lg bg-secondary/50 p-3">
                      <summary className="cursor-pointer font-medium">{phase.assessment.title} — end-of-phase assessment</summary>
                      <p className="mt-2 text-sm text-muted-foreground">{phase.assessment.purpose}</p>
                      {phase.assessment.tasks.map((task, index) => <label key={task} className="mt-3 block text-sm">{index + 1}. {task}<textarea className="mt-1 w-full rounded-md border bg-background p-2" rows={2} value={assessmentDraft[`${phase.id}:${index}`] ?? progress?.assessment_responses[`${phase.id}:${index}`] ?? ""} onChange={(event) => setAssessmentDraft((current) => ({ ...current, [`${phase.id}:${index}`]: event.target.value }))} /></label>)}
                      <p className="mt-3 text-sm"><strong>Rubric:</strong> {phase.assessment.rubric.join(" · ")}</p><p className="mt-1 text-sm"><strong>Pass criteria:</strong> {phase.assessment.passCriteria}</p>
                      <p className="mt-2 text-xs text-muted-foreground">Complete the phase topics first, answer each assessment task, and check your work against the rubric before continuing.</p>
                      <button disabled={!phaseUnlocked || !phase.topics.every((topic) => completedTopicIds.has(topic.id)) || !phase.assessment.tasks.every((_, index) => (assessmentDraft[`${phase.id}:${index}`] ?? progress?.assessment_responses[`${phase.id}:${index}`] ?? "").trim())} onClick={() => void submitAssessment(phase)} className="mt-3 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">Save assessment and continue</button>
                    </details>
                  </section>
                  );
                })}
              </div>
            </div>
          ) : course ? <div className="rounded-lg bg-secondary p-3 text-sm"><p>This saved course uses the legacy topic format and has no structured plan. Its topics are still available:</p><ol className="mt-2 list-decimal pl-5">{course.topics.map((topic) => <li key={topic.id} className="mt-1 flex items-center justify-between gap-2"><span>{topic.name} · ~{topic.minutes} min</span><button onClick={() => learn(`${topic.name} (part of: ${course.title})`)} className="rounded bg-background px-2 py-1">Review</button></li>)}</ol><p className="mt-2">Create a new structured plan when you want to continue with phase lessons and saved position.</p></div>
            : <p className="text-sm text-muted-foreground">{needsDiagnostic ? "Complete one diagnostic first. We'll use what you demonstrate rather than guessing your level." : "Tell us what you want to learn. We'll propose phases and lessons for you to review before saving."}</p>}

          {draft ? (
            <div className="space-y-4 rounded-xl border-2 border-primary/30 p-4">
              <div><h3 className="text-lg font-semibold">Review proposed plan: {draft.title}</h3><p className="text-sm text-muted-foreground">{draft.goal}</p></div>
              {draft.phases.map((phase, index) => <section key={phase.id}><h4 className="font-medium">Phase {index + 1}: {phase.title}</h4><p className="text-sm text-muted-foreground">{phase.purpose}</p><ol className="ml-5 list-decimal text-sm">{phase.topics.map((topic) => <li key={topic.id}>{topic.name} — {topic.objectives.join("; ")}<span className="block text-xs text-muted-foreground">Subtopics: {topic.subtopics.map((item) => item.name).join(", ")}</span></li>)}</ol><p className="mt-1 text-xs text-muted-foreground">Assessment: {phase.assessment.title} — {phase.assessment.purpose}</p></section>)}
              <div className="flex flex-wrap gap-2"><button disabled={creating} onClick={() => void saveDraft()} className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50">{creating ? "Saving…" : "Start this course"}</button><button disabled={creating} onClick={() => setDraft(null)} className="rounded-lg border px-4 py-2">Discard proposal</button></div>
            </div>
          ) : (
            <form className="space-y-3 border-t pt-4" onSubmit={(event) => { event.preventDefault(); void makeCourse(); }}>
              <label className="block text-sm font-medium">Learning goal<input value={courseGoal} onChange={(event) => setCourseGoal(event.target.value)} placeholder="e.g. Understand probability for my exam" className="mt-1 w-full rounded-lg border bg-background px-3 py-2" /></label>
              <label className="block text-sm font-medium">Relevant notes or material<textarea value={courseMaterial} onChange={(event) => setCourseMaterial(event.target.value.slice(0, 6000))} rows={3} placeholder="Paste class notes, syllabus topics or material to use as course context…" className="mt-1 w-full rounded-lg border bg-background p-2" /></label>
              {visionAvailable && <label className="block text-sm">Add a photo of notes or a worksheet<input type="file" accept="image/jpeg,image/png,image/webp" disabled={reading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void readMaterialPhoto(file); event.currentTarget.value = ""; }} className="mt-1 block w-full text-sm" />{reading && <span className="text-muted-foreground">Reading photo…</span>}</label>}
              <button disabled={creating || !courseGoal.trim() || needsDiagnostic} className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50">{creating ? "Building proposal…" : needsDiagnostic ? "Check a concept first" : "Build a plan to review"}</button>
            </form>
          )}
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        </section>

        <div className="space-y-8">
          <section className="card-paper p-6">
            <h2 className="text-xl font-semibold">Due for review</h2>
            {due.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nothing due. Topics come back here at the right time.</p> : <ul className="mt-3 space-y-2">{due.map((c) => <li key={c.id} className="flex items-center justify-between gap-2 text-sm"><span className="font-medium">{c.concept}</span><span className="flex gap-2"><button onClick={() => learn(c.concept)} className="rounded-md bg-secondary px-2 py-1">Review</button><button onClick={() => dismiss(c)} className="text-muted-foreground underline">Later</button></span></li>)}</ul>}
          </section>
          <section className="card-paper p-6">
            <h2 className="text-xl font-semibold">Your understanding</h2>
            {concepts.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Concepts you work on show up here.</p> : <ul className="mt-3 space-y-4">{concepts.map((c) => <li key={c.id} className="text-sm"><div className="flex items-start justify-between gap-2"><span className="font-medium">{c.concept}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${statusGroup(c.status) === "done" ? "bg-success text-success-foreground" : statusGroup(c.status) === "developing" ? "bg-secondary" : "bg-accent/20"}`}>{statusGroup(c.status) === "done" ? "Demonstrated" : statusGroup(c.status) === "developing" ? "Developing" : "Needs work"}</span></div>{statusGroup(c.status) !== "done" && c.misconceptions[0] && <p className="mt-1 text-muted-foreground">{c.misconceptions[0]}</p>}<p className="mt-1 text-xs text-muted-foreground">{c.attempts} attempt{c.attempts === 1 ? "" : "s"} · {c.clean_successes} without hints{c.review_at ? ` · review ${new Date(c.review_at).toLocaleDateString()}` : ""}</p>{c.last_explanation && <button onClick={() => setOpenExplanation(openExplanation === c.id ? null : c.id)} className="mt-1 text-xs text-accent underline">{openExplanation === c.id ? "Hide" : "See"} last explanation</button>}{openExplanation === c.id && <p className="mt-2 whitespace-pre-line rounded-md bg-secondary p-3 text-xs">{c.last_explanation}</p>}</li>)}</ul>}
          </section>
        </div>
      </div>
    </div>
  );
}
