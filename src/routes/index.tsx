import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { askTutor } from "@/lib/tutor.functions";
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
type Topic = { name: string; why: string; prerequisites: string[]; minutes: number };
type Course = { id: string; title: string; goal: string | null; outcomes: string[]; topics: Topic[]; created_at: string };

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

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });
    supabase.auth.getUser().then(({ data }) => { setUser(data.user ?? null); setAuthReady(true); });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!authReady) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!user && trial) return (
    <Shell right={<SignInButton small />}>
      <div className="mb-6 rounded-lg bg-secondary p-4 text-sm">You're trying UNSTUCK as a guest. <strong>Sign in with Google</strong> to save what you learn.</div>
      <LearnSession onExit={() => setTrial(false)} />
    </Shell>
  );
  if (!user) return <Welcome onTry={() => setTrial(true)} />;
  return <SignedIn user={user} />;
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
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (r.error) { setErr("Sign-in didn't finish. Please try again."); setBusy(false); return; }
    if (r.redirected) return;
    setBusy(false);
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

function Welcome({ onTry }: { onTry: () => void }) {
  return (
    <Shell>
      <section className="grid gap-12 pt-10 md:grid-cols-[1.3fr_1fr] md:items-center">
        <div>
          <h1 className="text-5xl font-semibold leading-[1.05] md:text-6xl">Understand what you <em className="text-accent">don't</em> understand.</h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">UNSTUCK finds why a concept isn't clicking, teaches it a different way, and checks you can use it on your own — then remembers what you've learned.</p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <SignInButton />
            <button onClick={onTry} className="text-sm underline underline-offset-4 hover:text-accent">Try a lesson first</button>
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

function SignedIn({ user }: { user: User }) {
  const ask = useServerFn(askTutor);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "home" });
  const [menu, setMenu] = useState(false);

  const load = useCallback(async () => {
    setLoadErr(null);
    const [p, c, k] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("concepts").select("*").order("updated_at", { ascending: false }),
      supabase.from("courses").select("*").order("created_at", { ascending: false }),
    ]);
    if (p.error || c.error || k.error) { setLoadErr("We couldn't load your learning profile."); return; }
    let prof = p.data as Profile | null;
    if (!prof) {
      const ins = await supabase.from("profiles").insert({ id: user.id, display_name: (user.user_metadata?.full_name as string) ?? null, avatar_url: (user.user_metadata?.avatar_url as string) ?? null }).select().single();
      prof = ins.data as Profile | null;
    }
    setProfile(prof);
    setConcepts((c.data ?? []) as Concept[]);
    setCourses((k.data ?? []) as unknown as Course[]);
  }, [user]);
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

  const signOut = async () => { await supabase.auth.signOut(); };

  const right = (
    <div className="relative">
      <button onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label="Account menu" className="flex items-center gap-2 rounded-full border bg-card p-1 pr-3 text-sm">
        {profile?.avatar_url ? <img src={profile.avatar_url} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" /> : <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground">{(profile?.display_name ?? user.email ?? "?")[0]}</span>}
        <span className="hidden sm:inline">{profile?.display_name?.split(" ")[0] ?? "Account"}</span>
      </button>
      {menu && (
        <div className="card-paper absolute right-0 z-10 mt-2 w-56 p-2 text-sm">
          <p className="truncate px-3 py-2 text-muted-foreground">{user.email}</p>
          <button className="block w-full rounded-md px-3 py-2 text-left hover:bg-secondary" onClick={() => { setView({ kind: "home" }); setMenu(false); }}>Dashboard</button>
          <button className="block w-full rounded-md px-3 py-2 text-left hover:bg-secondary" onClick={() => { setView({ kind: "settings" }); setMenu(false); }}>Learning preferences</button>
          <button className="block w-full rounded-md px-3 py-2 text-left hover:bg-secondary" onClick={signOut}>Sign out</button>
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
      <LearnSession key={view.key} initialTopic={view.topic} prefs={prefs} onRecord={record} onExit={() => setView({ kind: "home" })} />
    </Shell>
  );
  return (
    <Shell right={right}>
      <Dashboard profile={profile} concepts={concepts} courses={courses} ask={ask} prefs={prefs} setCourses={setCourses} userId={user.id}
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

function Dashboard({ profile, concepts, courses, ask, prefs, setCourses, userId, learn, dismiss }: {
  profile: Profile; concepts: Concept[]; courses: Course[]; ask: ReturnType<typeof useServerFn<typeof askTutor>>; prefs: Record<string, unknown> | undefined;
  setCourses: React.Dispatch<React.SetStateAction<Course[]>>; userId: string; learn: (t?: string) => void; dismiss: (c: Concept) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [courseGoal, setCourseGoal] = useState(profile.subject ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [openExplanation, setOpenExplanation] = useState<string | null>(null);
  const course = courses[0];
  const byName = new Map(concepts.map((c) => [c.concept.toLowerCase(), c]));
  const due = concepts.filter((c) => c.review_at && new Date(c.review_at) <= new Date());
  const work = concepts.filter((c) => statusGroup(c.status) === "work");
  const nextTopic = course?.topics.find((t) => statusGroup(byName.get(t.name.toLowerCase())?.status ?? "x") !== "done");
  const last = concepts[0];
  const away = last ? (Date.now() - new Date(last.updated_at).getTime()) / 86400000 : 0;

  const makeCourse = async () => {
    if (!courseGoal.trim() || creating) return;
    setCreating(true); setErr(null);
    try {
      const { json } = await ask({ data: { action: "course", payload: { wantsToLearn: courseGoal, ...prefs, alreadyDemonstrated: concepts.filter((c) => statusGroup(c.status) === "done").map((c) => c.concept) } } });
      const r = JSON.parse(json) as { title: string; goal: string; outcomes: string[]; topics: Topic[] };
      const { data, error } = await supabase.from("courses").insert({ user_id: userId, title: r.title, goal: r.goal, outcomes: r.outcomes, topics: r.topics }).select().single();
      if (error || !data) throw new Error("Couldn't save the course.");
      setCourses((c) => [data as unknown as Course, ...c]);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't build a course."); }
    finally { setCreating(false); }
  };

  const nextAction = due[0] ? { label: `Quick recall: ${due[0].concept}`, why: away > 3 ? "Welcome back — a short recap before moving on." : "It's time to check this one stuck.", go: () => learn(due[0]!.concept) }
    : nextTopic ? { label: `Next in your course: ${nextTopic.name}`, why: nextTopic.why, go: () => learn(`${nextTopic.name} (part of: ${course!.title})`) }
    : work[0] ? { label: `Keep working on: ${work[0].concept}`, why: "This one still needs practice.", go: () => learn(work[0]!.concept) }
    : { label: "Get unstuck on something new", why: "Bring a question or concept that's bugging you.", go: () => learn() };

  return (
    <div className="space-y-8">
      <section className="card-paper flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between md:p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">What to do next</p>
          <h1 className="mt-1 text-3xl font-semibold">{nextAction.label}</h1>
          <p className="mt-1 text-muted-foreground">{nextAction.why}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button onClick={nextAction.go} className="rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground">Start</button>
          <button onClick={() => learn()} className="rounded-lg border px-5 py-2.5">I'm stuck on something else</button>
        </div>
      </section>

      <CoachCard userId={userId} firstName={profile.display_name?.split(" ")[0] ?? null} prefs={prefs} concepts={concepts} dueCount={due.length} daysAway={away} />

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <section className="card-paper p-6">
          <h2 className="text-xl font-semibold">What you're learning</h2>
          {course ? (
            <>
              <p className="mt-1 font-medium">{course.title}</p>
              {course.goal && <p className="text-sm text-muted-foreground">{course.goal}</p>}
              <ol className="mt-4 space-y-2">
                {course.topics.map((t, i) => {
                  const c = byName.get(t.name.toLowerCase());
                  const g = c ? statusGroup(c.status) : "none";
                  return (
                    <li key={t.name} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                      <div className="min-w-0">
                        <p className="font-medium"><span className="mr-2 font-mono text-muted-foreground">{i + 1}</span>{t.name}</p>
                        <p className="text-xs text-muted-foreground">{c ? c.status : "Not assessed"} · ~{t.minutes} min{t.prerequisites?.length ? ` · builds on ${t.prerequisites.join(", ")}` : ""}</p>
                      </div>
                      <button onClick={() => learn(`${t.name} (part of: ${course.title})`)} className={`shrink-0 rounded-md px-3 py-1.5 text-sm ${g === "done" ? "border" : "bg-secondary"}`}>{g === "done" ? "Review" : c ? "Continue" : "Start"}</button>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-3 text-xs text-muted-foreground">A topic counts as demonstrated after two correct answers in a row, in different situations, without hints.</p>
            </>
          ) : <p className="mt-2 text-sm text-muted-foreground">No course yet. Tell us what you want to learn and we'll build a short plan around you.</p>}
          <form className="mt-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); makeCourse(); }}>
            <input value={courseGoal} onChange={(e) => setCourseGoal(e.target.value)} placeholder="e.g. Fractions, Newton's laws, probability" className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring" />
            <button disabled={creating || !courseGoal.trim()} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{creating ? "Building…" : course ? "New course" : "Build my course"}</button>
          </form>
          {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
        </section>

        <div className="space-y-8">
          <section className="card-paper p-6">
            <h2 className="text-xl font-semibold">Due for review</h2>
            {due.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nothing due. Topics come back here at the right time.</p> : (
              <ul className="mt-3 space-y-2">
                {due.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{c.concept}</span>
                    <span className="flex gap-2"><button onClick={() => learn(c.concept)} className="rounded-md bg-secondary px-2 py-1">Review</button><button onClick={() => dismiss(c)} className="text-muted-foreground underline">Later</button></span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card-paper p-6">
            <h2 className="text-xl font-semibold">Your understanding</h2>
            {concepts.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Concepts you work on show up here.</p> : (
              <ul className="mt-3 space-y-4">
                {concepts.map((c) => (
                  <li key={c.id} className="text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">{c.concept}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${statusGroup(c.status) === "done" ? "bg-success text-success-foreground" : statusGroup(c.status) === "developing" ? "bg-secondary" : "bg-accent/20"}`}>{statusGroup(c.status) === "done" ? "Demonstrated" : statusGroup(c.status) === "developing" ? "Developing" : "Needs work"}</span>
                    </div>
                    {statusGroup(c.status) !== "done" && c.misconceptions[0] && <p className="mt-1 text-muted-foreground">{c.misconceptions[0]}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">{c.attempts} attempt{c.attempts === 1 ? "" : "s"} · {c.clean_successes} without hints{c.review_at ? ` · review ${new Date(c.review_at).toLocaleDateString()}` : ""}</p>
                    {c.last_explanation && <button onClick={() => setOpenExplanation(openExplanation === c.id ? null : c.id)} className="mt-1 text-xs text-accent underline">{openExplanation === c.id ? "Hide" : "See"} last explanation</button>}
                    {openExplanation === c.id && <p className="mt-2 whitespace-pre-line rounded-md bg-secondary p-3 text-xs">{c.last_explanation}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
