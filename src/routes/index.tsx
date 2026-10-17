import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { getFirebaseAuth, isFirebaseConfigured, onAuthStateChanged, signInWithGoogle, signOut as firebaseSignOut, type User } from "@/integrations/firebase/client";
import { LearningHelper } from "@/components/LearningHelper";
import { askTutor } from "@/lib/tutor.functions";
import { publicCourseSchema, type CoursePlan } from "@/lib/tutor-schemas";
import { getCapabilities, readProblem } from "@/lib/google.functions";
import { shrinkImage } from "@/lib/image";
import { assignmentResultSchema, type AssignmentResult } from "@/lib/course-assessment";
import { evaluateCourseAssignment, recordAssessmentHint } from "@/lib/course-assessment.functions";
import { appendGuestProgress, clearGuestProgress, GUEST_PROGRESS_KEY, readGuestProgress, type GuestProgressBundle } from "@/lib/guest-progress";
import { adoptGuestSession } from "@/lib/session-storage";
import { daysSincePractice, rankDueConcepts, summarizeCourses } from "@/lib/learner-dashboard";
import { CoachCard } from "@/components/CoachCard";
import { LearnSession, type SessionRecord } from "@/components/LearnSession";
import {
  deleteConcept as deleteConceptFn,
  deleteCourse as deleteCourseFn,
  importGuestProgress,
  loadWorkspace,
  rescheduleConcept as rescheduleConceptFn,
  saveCourse as saveCourseFn,
  saveCourseProgress as saveCourseProgressFn,
  saveProfile as saveProfileFn,
} from "@/lib/workspace.functions";

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
type CourseProgressPatch = Partial<Pick<CourseProgress, "current_phase_id" | "current_topic_id">> & {
  completeTopicId?: string;
  skipTopicIds?: string[];
};
type CourseAssessmentAttempt = {
  attempt_id: string;
  course_id: string;
  phase_id: string;
  responses: unknown;
  evaluation: AssignmentResult;
  hints_used: number;
  retry_count: number;
  created_at: string;
};
type ImportedGuestActivity = {
  id: string;
  saved_at: string;
  source: "unverified-guest-history";
  record: { concept: string; correct: boolean; explanation: string | null; status: "Not assessed" };
};

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
  const [guestDashboard, setGuestDashboard] = useState(false);
  const [guestInitialTopic, setGuestInitialTopic] = useState<string | undefined>();
  const [guestProgress, setGuestProgress] = useState<GuestProgressBundle | null>(null);
  const [guestSaveError, setGuestSaveError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  useEffect(() => {
    let hadUser = false;
    try {
      setGuestProgress(readGuestProgress(window.localStorage));
    } catch {
      setGuestSaveError("We couldn't read saved guest progress on this device. It has not been deleted.");
    }
    if (!isFirebaseConfigured()) {
      setAuthNotice("Google sign-in is not configured yet. Guest learning remains available on this device.");
      setAuthReady(true);
      return;
    }
    let unsubscribe = () => {};
    try {
      unsubscribe = onAuthStateChanged(getFirebaseAuth(), (authUser) => {
        if (authUser) {
          hadUser = true;
          setAuthNotice(null);
          try { adoptGuestSession(window.localStorage, authUser.uid); } catch {
            setAuthNotice("Your guest session is still saved on this device, but we couldn't move it into your account automatically.");
          }
        } else if (hadUser) {
          setAuthNotice("Your sign-in session ended. Continue with Google to reopen your learning workspace.");
          hadUser = false;
        }
        setUser(authUser);
        setAuthReady(true);
      }, () => {
        setAuthNotice("We couldn't confirm your sign-in. Please check your connection and try again.");
        setAuthReady(true);
      });
    } catch {
      setAuthNotice("Firebase sign-in couldn't be initialized. Guest learning remains available.");
      setAuthReady(true);
    }
    return () => unsubscribe();
  }, []);

  if (!authReady) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!user && trial) return (
    <Shell right={<SignInButton small />}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-secondary p-4 text-sm">
        <p>You're using UNSTUCK as a guest. Progress is saved on this device, not synced to an account. <strong>Continue with Google</strong> to bring completed attempts to your learning workspace.{guestProgress?.events.length ? ` ${guestProgress.events.length} completed ${guestProgress.events.length === 1 ? "attempt is" : "attempts are"} saved.` : ""}</p>
        <button type="button" onClick={() => setGuestDashboard((shown) => !shown)} className="shrink-0 rounded-md border bg-background px-3 py-1.5">{guestDashboard ? "Continue learning" : "View saved progress"}</button>
      </div>
      {authNotice && <p role="alert" className="mb-4 text-sm text-destructive">{authNotice}</p>}
      {guestSaveError && <p role="alert" className="mb-4 text-sm text-destructive">{guestSaveError}</p>}
      {guestDashboard ? (
        <GuestDashboard
          progress={guestProgress}
          onContinue={(topic) => { setGuestInitialTopic(topic); setGuestDashboard(false); }}
          onClear={() => {
            if (!window.confirm("Delete this device's guest learning attempts and unfinished guest session? Your signed-in learning workspace will not be changed.")) return;
            try {
              window.localStorage.removeItem(GUEST_PROGRESS_KEY);
              window.localStorage.removeItem("unstuck.guest-session.v1");
              window.localStorage.removeItem("unstuck.helper.v1:unstuck.guest-session.v1");
              setGuestProgress(readGuestProgress(window.localStorage));
              setGuestInitialTopic(undefined);
              setGuestSaveError(null);
            } catch {
              setGuestSaveError("Guest data could not be deleted from this device.");
            }
          }}
        />
      ) : (
        <LearnSession initialTopic={guestInitialTopic} storageKey="unstuck.guest-session.v1" onRecord={(r) => {
          try {
            const current = guestProgress ?? readGuestProgress(window.localStorage);
            const next = appendGuestProgress(current, r);
            window.localStorage.setItem(GUEST_PROGRESS_KEY, JSON.stringify(next));
            setGuestProgress(next);
            setGuestSaveError(null);
          } catch {
            setGuestSaveError("This attempt couldn't be saved on this device. Please allow local storage and try again.");
          }
        }} onExit={() => setGuestDashboard(true)} />
      )}
    </Shell>
  );
  if (!user) return <Welcome onTry={() => { setTrial(true); setGuestDashboard(false); }} authNotice={authNotice} />;
  return <SignedIn user={user} onGuestImport={() => setGuestProgress(null)} />;
}

function GuestDashboard({ progress, onContinue, onClear }: {
  progress: GuestProgressBundle | null;
  onContinue: (topic?: string) => void;
  onClear: () => void;
}) {
  const events = progress?.events ?? [];
  const latestByConcept = new Map<string, GuestProgressBundle["events"][number]>();
  for (const event of events) {
    const key = event.record.concept.toLowerCase();
    const previous = latestByConcept.get(key);
    if (!previous || Date.parse(event.savedAt) > Date.parse(previous.savedAt)) latestByConcept.set(key, event);
  }
  const concepts = Array.from(latestByConcept.values()).sort((a, b) =>
    Date.parse(b.savedAt) - Date.parse(a.savedAt));
  const nextConcept = concepts.find((event) => !event.record.status.startsWith("Demonstrated")) ?? concepts[0];
  return (
    <div className="space-y-6">
      <section className="card-paper space-y-3 p-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Guest learning snapshot</p>
        <h1 className="text-3xl font-semibold">Your progress on this device</h1>
        <p className="text-sm text-muted-foreground">This summary uses only saved guest attempts. It is local to this browser; courses, synced preferences and cross-device history are available after Google sign-in.</p>
        {events.length === 0 ? (
          <div className="rounded-lg bg-secondary p-4 text-sm">No completed attempts have been saved yet. Start a learning check and your results will appear here.</div>
        ) : (
          <>
            {nextConcept && (
              <div className="rounded-lg border p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-accent">Suggested next</p>
                <p className="mt-1 font-medium">{nextConcept.record.status.startsWith("Demonstrated") ? "Revisit" : "Continue practicing"}: {nextConcept.record.concept}</p>
                <p className="mt-1 text-sm text-muted-foreground">{nextConcept.record.status.startsWith("Demonstrated") ? "Your latest saved attempt met the current criteria; a later recall can check whether it lasts." : "Your latest saved attempt is still developing or unresolved, so another check may help."}</p>
                <button type="button" onClick={() => onContinue(nextConcept.record.concept)} className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Continue with this concept</button>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-secondary p-3"><p className="text-2xl font-semibold">{events.length}</p><p className="text-xs text-muted-foreground">saved completed attempts</p></div>
              <div className="rounded-lg bg-secondary p-3"><p className="text-2xl font-semibold">{concepts.filter((event) => event.record.status.startsWith("Demonstrated")).length}</p><p className="text-xs text-muted-foreground">concepts demonstrated under current criteria</p></div>
              <div className="rounded-lg bg-secondary p-3"><p className="text-2xl font-semibold">{concepts.filter((event) => !event.record.status.startsWith("Demonstrated")).length}</p><p className="text-xs text-muted-foreground">concepts still developing or unresolved</p></div>
            </div>
            <section>
              <h2 className="font-semibold">Recent learning</h2>
              <ul className="mt-2 divide-y">
                {events.slice().reverse().slice(0, 8).map((event) => (
                  <li key={event.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                    <span><strong>{event.record.concept}</strong> · {event.record.status}{event.record.clean ? " · without hints" : ""}</span>
                    <time className="text-xs text-muted-foreground" dateTime={event.savedAt}>{new Date(event.savedAt).toLocaleDateString()}</time>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <button type="button" onClick={() => onContinue()} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Start a learning check</button>
          <button type="button" onClick={onClear} className="text-sm text-destructive underline">Delete guest progress from this device</button>
        </div>
      </section>
    </div>
  );
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
      await signInWithGoogle();
      setBusy(false);
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      setErr(code === "auth/popup-closed-by-user"
        ? "Google sign-in was cancelled. You can try again or continue as a guest."
        : "Google sign-in couldn't be completed. Check your connection and try again.");
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
  const gradeAssignment = useServerFn(evaluateCourseAssignment);
  const readWorkspace = useServerFn(loadWorkspace);
  const updateConceptReview = useServerFn(rescheduleConceptFn);
  const deleteSavedConcept = useServerFn(deleteConceptFn);
  const updateProfile = useServerFn(saveProfileFn);
  const deleteSavedCourse = useServerFn(deleteCourseFn);
  const updateCoursePosition = useServerFn(saveCourseProgressFn);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseProgress, setCourseProgress] = useState<Record<string, CourseProgress>>({});
  const [assessmentAttempts, setAssessmentAttempts] = useState<CourseAssessmentAttempt[]>([]);
  const [importedGuestActivity, setImportedGuestActivity] = useState<ImportedGuestActivity[]>([]);
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
    try {
      const workspace = await readWorkspace({ data: { displayName: user.displayName, avatarUrl: user.photoURL } });
      const prof = workspace.profile as Profile | null;
      setProfile(prof);
      setConcepts(workspace.concepts as unknown as Concept[]);
      const parsedCourses: Course[] = [];
      for (const row of workspace.courses as Record<string, unknown>[]) {
        let plan: CoursePlan | null = null;
        if (row["plan"]) {
          const parsed = publicCourseSchema.safeParse(row["plan"]);
          if (parsed.success) plan = parsed.data;
        }
        parsedCourses.push({ ...row, plan, topics: (row["topics"] ?? []) as unknown as Topic[] } as Course);
      }
      setCourses(parsedCourses);
      setCourseProgress(Object.fromEntries(Object.values(workspace.courseProgress as Record<string, Record<string, unknown>>).map((row) => [row["course_id"] as string, {
        ...row,
        assessment_responses: (row["assessment_responses"] ?? {}) as Record<string, string>,
      } as unknown as CourseProgress])));
      setAssessmentAttempts((workspace.assessmentAttempts as Record<string, unknown>[]).flatMap((row) => {
        const evaluation = assignmentResultSchema.safeParse(row["evaluation"]);
        return evaluation.success ? [{ ...row, evaluation: evaluation.data } as unknown as CourseAssessmentAttempt] : [];
      }));
      setImportedGuestActivity(workspace.guestActivity.flatMap((row) => {
        const parsed = zImportedGuestActivity.safeParse(row);
        return parsed.success ? [parsed.data] : [];
      }));
    } catch {
      setLoadErr("We couldn't load your Firebase learning workspace. Check your connection and retry.");
    }
  }, [user, importProgress, onGuestImport, readWorkspace]);
  useEffect(() => { load(); }, [load]);

  const prefs = profile ? { goal: profile.goal, subject: profile.subject, selfReportedLevel: profile.level, studyMinutesPerSession: profile.study_minutes, preferredStyles: profile.preferred_styles } : undefined;

  const record = async (_record: SessionRecord) => {
    await load();
  };

  const rememberAssessmentAttempt = (attempt: CourseAssessmentAttempt) => {
    setAssessmentAttempts((current) => {
      const existing = current.find((item) => item.attempt_id === attempt.attempt_id);
      return existing ? current.map((item) => item.attempt_id === attempt.attempt_id ? attempt : item) : [attempt, ...current];
    });
  };

  const forgetCourse = (courseId: string): string | null => {
    setCourses((current) => current.filter((course) => course.id !== courseId));
    setCourseProgress((current) => {
      const next = { ...current };
      delete next[courseId];
      return next;
    });
    setAssessmentAttempts((current) => current.filter((attempt) => attempt.course_id !== courseId));
    try {
      const prefixes = [
        `unstuck.helper.v1:${user.uid}:${courseId}:`,
        `unstuck.course-hints.v1:${user.uid}:${courseId}`,
        `unstuck.course-assessment-pending.v1:${user.uid}:${courseId}:`,
      ];
      for (let index = window.localStorage.length - 1; index >= 0; index--) {
        const key = window.localStorage.key(index);
        if (key && prefixes.some((prefix) => key.startsWith(prefix))) window.localStorage.removeItem(key);
      }
    } catch {
      return "The course was deleted from your account, but some device-local helper history could not be removed.";
    }
    return null;
  };

  const deleteConcept = async (concept: Concept) => {
    await deleteSavedConcept({ data: { conceptId: concept.id } });
    setConcepts((current) => current.filter((item) => item.id !== concept.id));
  };

  const saveCourseProgress = async (courseId: string, patch: CourseProgressPatch) => {
    const data = await updateCoursePosition({ data: { courseId, patch } });
    const saved = { ...data, assessment_responses: {} } as CourseProgress;
    setCourseProgress((current) => ({ ...current, [courseId]: saved }));
    return saved;
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await firebaseSignOut(getFirebaseAuth());
      setAuthError(null);
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
      <Onboarding profile={profile} editing={profile.onboarded} saveProfile={async (patch) => await updateProfile({ data: patch }) as Profile} onDone={async (p, next) => { setProfile(p); if (next) setView({ kind: "learn", topic: next, key: Date.now() }); else setView({ kind: "home" }); }} />
    </Shell>
  );
  if (view.kind === "learn") return (
    <Shell right={right}>
      <button onClick={() => setView({ kind: "home" })} className="mb-4 text-sm text-muted-foreground hover:text-foreground">← Back to dashboard</button>
      <LearnSession key={view.key} storageKey={`unstuck.user-session.v1:${user.uid}`} initialTopic={view.topic} prefs={prefs} onRecord={record} onExit={() => setView({ kind: "home" })} />
    </Shell>
  );
  return (
    <Shell right={right}>
      <Dashboard profile={profile} concepts={concepts} courses={courses} courseProgress={courseProgress} saveCourseProgress={saveCourseProgress} assessmentAttempts={assessmentAttempts} importedGuestActivity={importedGuestActivity} gradeAssignment={gradeAssignment} rememberAssessmentAttempt={rememberAssessmentAttempt} ask={ask} prefs={prefs} setCourses={setCourses} userId={user.uid} onForgetCourse={forgetCourse} onDeleteConcept={deleteConcept}
        learn={(topic) => setView({ kind: "learn", topic, key: Date.now() })}
        dismiss={async (c) => { const { review_at } = await updateConceptReview({ data: { conceptId: c.id } }); setConcepts((cs) => cs.map((x) => x.id === c.id ? { ...x, review_at } : x)); }}
      />
    </Shell>
  );
}

function Onboarding({ profile, editing, saveProfile, onDone }: { profile: Profile; editing: boolean; saveProfile: (patch: { goal?: string | null; subject?: string | null; level?: string | null; study_minutes?: number; preferred_styles?: string[]; onboarded?: boolean }) => Promise<Profile>; onDone: (p: Profile, next?: string) => void }) {
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
    const patch = skip ? { onboarded: true } : { goal: goal || null, subject: subject || null, level: level || null, study_minutes: minutes, preferred_styles: styles, onboarded: true };
    try {
      const data = await saveProfile(patch);
      onDone(data, !skip && stuck.trim() ? stuck.trim() : undefined);
    } catch {
      setErr("Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
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
const zImportedGuestActivity = z.object({
  id: z.string(),
  saved_at: z.string(),
  source: z.literal("unverified-guest-history"),
  record: z.object({
    concept: z.string(),
    correct: z.boolean(),
    explanation: z.string().nullable(),
    status: z.literal("Not assessed"),
  }),
});

function Dashboard({ profile, concepts, courses, courseProgress, saveCourseProgress, assessmentAttempts, importedGuestActivity, gradeAssignment, rememberAssessmentAttempt, ask, prefs, setCourses, userId, onForgetCourse, onDeleteConcept, learn, dismiss }: {
  profile: Profile; concepts: Concept[]; courses: Course[]; courseProgress: Record<string, CourseProgress>;
  saveCourseProgress: (courseId: string, patch: CourseProgressPatch) => Promise<CourseProgress>;
  assessmentAttempts: CourseAssessmentAttempt[];
  importedGuestActivity: ImportedGuestActivity[];
  gradeAssignment: ReturnType<typeof useServerFn<typeof evaluateCourseAssignment>>;
  rememberAssessmentAttempt: (attempt: CourseAssessmentAttempt) => void;
  ask: ReturnType<typeof useServerFn<typeof askTutor>>; prefs: Record<string, unknown> | undefined;
  setCourses: React.Dispatch<React.SetStateAction<Course[]>>; userId: string;
  onForgetCourse: (courseId: string) => string | null; onDeleteConcept: (concept: Concept) => Promise<void>;
  learn: (t?: string) => void; dismiss: (c: Concept) => void;
}) {
  const readPhoto = useServerFn(readProblem);
  const saveAssessmentHint = useServerFn(recordAssessmentHint);
  const capabilities = useServerFn(getCapabilities);
  const createSavedCourse = useServerFn(saveCourseFn);
  const deleteSavedCourse = useServerFn(deleteCourseFn);
  const [creating, setCreating] = useState(false);
  const [reading, setReading] = useState(false);
  const [visionAvailable, setVisionAvailable] = useState(false);
  const [courseGoal, setCourseGoal] = useState(profile.subject ?? "");
  const [courseMaterial, setCourseMaterial] = useState("");
  const [draft, setDraft] = useState<CoursePlan | null>(null);
  const [activeCourseId, setActiveCourseId] = useState(() =>
    summarizeCourses(courses, courseProgress, assessmentAttempts)[0]?.course.id ?? courses[0]?.id ?? "");
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [objectiveAnswers, setObjectiveAnswers] = useState<Record<string, number>>({});
  const [writtenAnswers, setWrittenAnswers] = useState<Record<string, string>>({});
  const [followUpAnswers, setFollowUpAnswers] = useState<Record<string, string>>({});
  const [usedHints, setUsedHints] = useState<Record<string, string[]>>({});
  const [readyHintStorageKey, setReadyHintStorageKey] = useState<string | null>(null);
  const [pendingAttemptIds, setPendingAttemptIds] = useState<Record<string, string>>({});
  const [submittingPhaseId, setSubmittingPhaseId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openExplanation, setOpenExplanation] = useState<string | null>(null);
  const [openAssignmentKey, setOpenAssignmentKey] = useState<string | null>(null);
  const [showAllAttempts, setShowAllAttempts] = useState(false);
  const [deletingCourse, setDeletingCourse] = useState(false);
  const [resettingCourse, setResettingCourse] = useState(false);
  const [deletingConceptId, setDeletingConceptId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const course = courses.find((c) => c.id === activeCourseId) ?? courses[0];
  const plan = course?.plan ?? null;
  const progress = course ? courseProgress[course.id] : undefined;
  const byName = new Map(concepts.map((c) => [c.concept.toLowerCase(), c]));
  const needsDiagnostic = concepts.length === 0;
  const due = rankDueConcepts(concepts, Date.now());
  const work = concepts.filter((c) => statusGroup(c.status) === "work");
  const courseSummaries = summarizeCourses(courses, courseProgress, assessmentAttempts);
  const activeSummary = courseSummaries.find((summary) => summary.course.id === course?.id);
  const recentAttempts = assessmentAttempts.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const topicEntries = plan?.phases.flatMap((phase) => phase.topics.map((topic) => ({ phase, topic }))) ?? [];
  const completedTopicIds = new Set(progress?.completed_topic_ids ?? []);
  const courseAttempts = assessmentAttempts.filter((attempt) => attempt.course_id === course?.id);
  const usesGradedAssignments = !!plan?.phases.every((phase) => !!phase.assessment.answerToken);
  const completedPhaseIds = new Set([
    ...(!usesGradedAssignments ? progress?.completed_phase_ids ?? [] : []),
    ...courseAttempts.filter((attempt) => attempt.evaluation.passed && !attempt.evaluation.needsFollowUp).map((attempt) => attempt.phase_id),
  ]);
  const openPhase = plan?.phases.find((phase) => !completedPhaseIds.has(phase.id));
  const firstOpenTopic = openPhase?.topics.find((topic) => !completedTopicIds.has(topic.id));
  const firstOpenEntry = topicEntries.find(({ phase, topic }) => phase.id === openPhase?.id && topic.id === firstOpenTopic?.id);
  const currentEntry = topicEntries.find(({ phase, topic }) => phase.id === openPhase?.id && topic.id === activeTopicId)
    ?? topicEntries.find(({ phase, topic }) => phase.id === openPhase?.id && topic.id === progress?.current_topic_id)
    ?? firstOpenEntry;
  const last = concepts[0];
  const away = last ? (Date.now() - new Date(last.updated_at).getTime()) / 86400000 : 0;
  const hintStorageKey = `unstuck.course-hints.v1:${userId}:${course?.id ?? "none"}`;

  useEffect(() => {
    capabilities().then((result) => setVisionAvailable(result.vision)).catch(() => setVisionAvailable(false));
  }, [capabilities]);

  useEffect(() => {
    setReadyHintStorageKey(null);
    try {
      const raw = window.localStorage.getItem(hintStorageKey);
      const value: unknown = raw ? JSON.parse(raw) : {};
      const restored: Record<string, string[]> = {};
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        for (const [phaseId, ids] of Object.entries(value)) {
          if (Array.isArray(ids)) restored[phaseId] = ids.filter((id): id is string => typeof id === "string" && id.length <= 40).slice(0, 10);
        }
      }
      setUsedHints(restored);
    } catch {
      setErr("Assessment hint history couldn't be read from this device; use of a new hint will still be recorded.");
      setUsedHints({});
    }
    setReadyHintStorageKey(hintStorageKey);
  }, [hintStorageKey]);

  useEffect(() => {
    if (readyHintStorageKey !== hintStorageKey) return;
    try {
      window.localStorage.setItem(hintStorageKey, JSON.stringify(usedHints));
    } catch {
      setErr("Assessment hint history couldn't be saved on this device.");
    }
  }, [hintStorageKey, readyHintStorageKey, usedHints]);

  const markHintUsed = async (phaseId: string, questionId: string) => {
    if ((usedHints[phaseId] ?? []).includes(questionId)) return;
    if (!course) return;
    try {
      const result = await saveAssessmentHint({ data: { courseId: course.id, phaseId, questionId } });
      setUsedHints((current) => ({
        ...current,
        [phaseId]: Array.from(new Set([...(current[phaseId] ?? []), ...result.questionIds])),
      }));
    } catch (error) {
      setErr(error instanceof Error ? error.message : "This hint couldn't be recorded. Please try again.");
    }
  };

  const resetCourse = async () => {
    if (!course?.plan || resettingCourse) return;
    if (!window.confirm(`Start a fresh copy of "${course.title}"? Its existing lessons, progress, and assessment history will remain saved.`)) return;
    setResettingCourse(true); setErr(null);
    const firstPhase = course.plan.phases[0];
    const firstTopic = firstPhase?.topics[0];
    if (!firstPhase || !firstTopic) {
      setErr("This course has no saved starting lesson to reset to.");
      setResettingCourse(false);
      return;
    }
    let data: Awaited<ReturnType<typeof createSavedCourse>>;
    try {
      data = await createSavedCourse({ data: {
      title: course.title,
      goal: course.goal,
      outcomes: course.outcomes,
      topics: course.topics,
      plan: course.plan,
      } });
    } catch {
      setErr("Couldn't create a fresh course copy. Your saved course and progress are unchanged.");
      setResettingCourse(false);
      return;
    }
    const freshCourse = { ...data, plan: course.plan, topics: course.topics } as unknown as Course;
    setCourses((current) => [freshCourse, ...current]);
    setActiveCourseId(freshCourse.id);
    setActiveTopicId(firstTopic.id);
    try {
      await saveCourseProgress(freshCourse.id, {
        current_phase_id: firstPhase.id,
        current_topic_id: firstTopic.id,
      });
      setErr(null);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "A fresh course copy was saved, but its starting position couldn't be saved.");
    } finally {
      setResettingCourse(false);
    }
  };

  const deleteCourse = async () => {
    if (!course || deletingCourse) return;
    if (!window.confirm(`Delete "${course.title}", its saved position, and its assessment attempts? This cannot be undone. Other courses and concept history will remain.`)) return;
    setDeletingCourse(true); setErr(null);
    try {
      await deleteSavedCourse({ data: { courseId: course.id } });
    } catch {
      setErr("Couldn't delete this course. Its saved plan and progress are unchanged.");
      setDeletingCourse(false);
      return;
    }
    const cleanupNotice = onForgetCourse(course.id);
    const remaining = courseSummaries.find((summary) => summary.course.id !== course.id)?.course;
    setActiveCourseId(remaining?.id ?? "");
    setActiveTopicId(null);
    if (cleanupNotice) setErr(cleanupNotice);
    setDeletingCourse(false);
  };

  const removeConcept = async (concept: Concept) => {
    if (deletingConceptId) return;
    if (!window.confirm(`Delete the saved concept summary and review schedule for "${concept.concept}"? Course and assessment history will remain.`)) return;
    setDeletingConceptId(concept.id); setHistoryError(null);
    try {
      await onDeleteConcept(concept);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Couldn't delete this concept history.");
    } finally {
      setDeletingConceptId(null);
    }
  };

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
      const parsed = publicCourseSchema.safeParse(JSON.parse(json));
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
    let data: Awaited<ReturnType<typeof createSavedCourse>>;
    try {
      data = await createSavedCourse({ data: {
        title: draft.title, goal: draft.goal, outcomes: draft.outcomes, topics, plan: draft,
      } });
    } catch {
      setErr("Couldn't save the plan. The proposed plan is still available to review.");
      setCreating(false);
      return;
    }
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
    const previous = courseProgress[selected.id];
    const previouslyCompleted = new Set(previous?.completed_topic_ids ?? []);
    const covered = entries
      .filter(({ topic }) => !previouslyCompleted.has(topic.id) && hasDemonstratedCover(topic))
      .map(({ topic }) => topic.id);
    const completed = Array.from(new Set([...(previous?.completed_topic_ids ?? []), ...covered]));
    const selectedAttempts = assessmentAttempts.filter((attempt) => attempt.course_id === selected.id);
    const usesGraded = selected.plan.phases.every((phase) => !!phase.assessment.answerToken);
    const completedPhases = new Set([
      ...(!usesGraded ? previous?.completed_phase_ids ?? [] : []),
      ...selectedAttempts.filter((attempt) => attempt.evaluation.passed && !attempt.evaluation.needsFollowUp).map((attempt) => attempt.phase_id),
    ]);
    const openPhase = selected.plan.phases.find((phase) => !completedPhases.has(phase.id));
    const savedPosition = entries.find(({ phase, topic }) => phase.id === openPhase?.id && topic.id === previous?.current_topic_id && !completed.includes(topic.id));
    const next = savedPosition ?? openPhase?.topics.find((topic) => !completed.includes(topic.id));
    const nextPhaseId = openPhase?.id ?? null;
    try {
      await saveCourseProgress(selected.id, {
        skipTopicIds: covered,
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
        completeTopicId: currentEntry.topic.id,
        current_phase_id: openPhase?.id ?? null,
        current_topic_id: next?.id ?? null,
      });
      setActiveTopicId(next?.id ?? null);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save your course progress."); }
  };

  const submitAssessment = async (phase: CoursePlan["phases"][number]) => {
    if (!course || !phase.assessment.answerToken || submittingPhaseId || readyHintStorageKey !== hintStorageKey) return;
    const submissionKey = `${course.id}:${phase.id}`;
    const priorResults = courseAttempts.filter((attempt) => attempt.phase_id === phase.id);
    const latest = priorResults[0];
    const objectiveQs = phase.assessment.objectiveQuestions ?? [];
    const openQs = phase.assessment.openQuestions ?? [];
    const objectives = Object.fromEntries(objectiveQs.map((question) => [
      question.id,
      objectiveAnswers[`${course.id}:${phase.id}:${question.id}`],
    ]));
    const written = Object.fromEntries(openQs.map((question) => {
      const responseKey = `${course.id}:${phase.id}:${question.id}`;
      const base = writtenAnswers[responseKey] ?? "";
      const followUp = followUpAnswers[responseKey]?.trim();
      const followUpQuestion = latest?.evaluation.followUpQuestionId === question.id ? latest.evaluation.followUpQuestion : null;
      return [question.id, followUpQuestion && followUp
        ? `${base}\n\nFollow-up question: ${followUpQuestion}\nLearner follow-up: ${followUp}`
        : base];
    }));
    const storageKey = `unstuck.course-assessment-pending.v1:${userId}:${course.id}:${phase.id}`;
    let attemptId = pendingAttemptIds[submissionKey];
    if (!attemptId) {
      try {
        const stored = window.localStorage.getItem(storageKey);
        const pending = stored ? JSON.parse(stored) as { attemptId?: unknown; completed?: unknown } : null;
        attemptId = pending?.completed === false && typeof pending.attemptId === "string" ? pending.attemptId : crypto.randomUUID();
        window.localStorage.setItem(storageKey, JSON.stringify({ attemptId, completed: false }));
      } catch {
        setErr("This browser couldn't save a retry-safe submission id. Enable local storage and try again.");
        return;
      }
    }
    setPendingAttemptIds((current) => ({ ...current, [submissionKey]: attemptId }));
    setSubmittingPhaseId(submissionKey); setErr(null);
    try {
      const attempt = (await gradeAssignment({ data: {
        attemptId,
        courseId: course.id,
        phaseId: phase.id,
        answerToken: phase.assessment.answerToken,
        objectiveAnswers: objectives,
        writtenAnswers: written,
      } })) as Record<string, unknown>;
      const parsed = assignmentResultSchema.safeParse(attempt["evaluation"]);
      if (!parsed.success) throw new Error("The saved assessment result could not be validated. Please reload your course.");
      const saved = { ...attempt, evaluation: parsed.data } as unknown as CourseAssessmentAttempt;
      rememberAssessmentAttempt(saved);
      try { window.localStorage.setItem(storageKey, JSON.stringify({ attemptId, completed: true })); } catch {
        setErr("Your score is saved, but this browser couldn't record the finished submission marker.");
      }
      setPendingAttemptIds((current) => {
        const next = { ...current };
        delete next[submissionKey];
        return next;
      });
      setFollowUpAnswers((current) => {
        const next = { ...current };
        for (const question of openQs) delete next[`${course.id}:${phase.id}:${question.id}`];
        return next;
      });
      setUsedHints((current) => ({ ...current, [phase.id]: [] }));
      if (parsed.data.passed && !parsed.data.needsFollowUp) {
        const nextPhase = plan?.phases.find((item, index) => index > plan.phases.findIndex((candidate) => candidate.id === phase.id) && !completedPhaseIds.has(item.id));
        const firstTopic = nextPhase?.topics[0];
        await saveCourseProgress(course.id, {
          current_phase_id: nextPhase?.id ?? null,
          current_topic_id: firstTopic?.id ?? null,
        });
        setActiveTopicId(firstTopic?.id ?? null);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't submit this assignment. Retry safely; duplicate submissions keep the original result.");
    } finally { setSubmittingPhaseId(null); }
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

  const goToCourseNext = (summary: (typeof courseSummaries)[number]) => {
    const action = summary.next;
    if (!action || action.kind === "complete") return;
    setActiveCourseId(summary.course.id);
    if (action.kind === "topic") {
      void saveCourseProgress(summary.course.id, {
        current_phase_id: action.phaseId,
        current_topic_id: action.topic.id,
      }).then(() => {
        setActiveTopicId(action.topic.id);
        setErr(null);
      }).catch((error) => setErr(error instanceof Error ? error.message : "Couldn't save your course position."));
      return;
    }
    setActiveTopicId(null);
    const assignmentKey = `${summary.course.id}:${action.phaseId}`;
    setOpenAssignmentKey(assignmentKey);
    window.setTimeout(() => {
      const details = document.getElementById(`phase-assignment-${assignmentKey}`);
      if (details) {
        (details as HTMLDetailsElement).open = true;
        details.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 0);
  };

  const nextDue = due[0];
  const daysSinceNextReview = nextDue ? daysSincePractice(nextDue.updated_at, Date.now()) : null;
  const recommendedCourse = courseSummaries.find((summary) => !summary.completed && summary.next) ?? null;
  const nextAction = nextDue ? {
    label: `Short revision: ${nextDue.concept}`,
    why: `${nextDue.status === "Progressing" ? "Your last attempt was developing" : nextDue.status.startsWith("Demonstrated") ? "This concept met the current criteria" : nextDue.status === "Not assessed" ? "There isn't enough saved evidence yet" : "Your recorded work still needs practice"}; its review date has arrived. Last practiced ${daysSinceNextReview} day${daysSinceNextReview === 1 ? "" : "s"} ago.`,
    go: () => learn(nextDue.concept),
  } : recommendedCourse?.next?.kind === "topic" ? {
    label: `Resume ${recommendedCourse.course.title}: ${recommendedCourse.next.topic.name}`,
    why: `${recommendedCourse.next.topic.name} is the next unfinished lesson in ${recommendedCourse.phaseTitle ?? "your course"}.`,
    go: () => goToCourseNext(recommendedCourse),
  } : recommendedCourse?.next?.kind === "assessment" ? {
    label: `Complete ${recommendedCourse.next.phaseTitle} assessment`,
    why: "The phase lessons are complete; this assignment is the next course step.",
    go: () => goToCourseNext(recommendedCourse),
  } : work[0] ? {
    label: `Practice: ${work[0].concept}`,
    why: "Your saved learning record marks this concept as needing more practice.",
    go: () => learn(work[0]!.concept),
  } : concepts.length ? {
    label: "Choose what to learn next",
    why: "Your saved concepts met their current criteria. You can revisit one later or start a new topic.",
    go: () => learn(),
  } : {
    label: "Start a learning check",
    why: "Bring a question or concept that's bugging you.",
    go: () => learn(),
  };

  return (
    <div className="space-y-8">
      <section className="card-paper flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between md:p-8">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-accent">What to do next</p><h1 className="mt-1 text-3xl font-semibold">{nextAction.label}</h1><p className="mt-1 text-muted-foreground">{nextAction.why}</p></div>
        <div className="flex flex-wrap gap-3"><button onClick={nextAction.go} className="rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground">Start</button><button onClick={() => learn()} className="rounded-lg border px-5 py-2.5">I'm stuck on something else</button></div>
      </section>

      <CoachCard userId={userId} firstName={profile.display_name?.split(" ")[0] ?? null} prefs={prefs} concepts={concepts} dueCount={due.length} daysAway={away} />

      <section className="card-paper p-6" aria-labelledby="course-overview-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="course-overview-heading" className="text-xl font-semibold">What you're learning</h2>
            <p className="mt-1 text-sm text-muted-foreground">Course position and lesson completion come from your saved progress; assessment completion is shown separately.</p>
          </div>
          {profile.subject && <p className="text-sm"><span className="text-muted-foreground">Focus:</span> {profile.subject}{profile.goal ? ` · ${profile.goal}` : ""}</p>}
        </div>
        {courseSummaries.length === 0 ? (
          <p className="mt-4 rounded-lg bg-secondary p-4 text-sm">No saved courses yet. Start a learning check, then build a course plan when you're ready.</p>
        ) : (
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {courseSummaries.map((summary) => {
              const nextTopic = summary.next?.kind === "topic" ? summary.next.topic : null;
              const isSelected = summary.course.id === course?.id;
              return (
                <li key={summary.course.id} className={`rounded-lg border p-4 ${isSelected ? "border-primary/50 bg-secondary/40" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold">{summary.course.title}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{!summary.course.plan ? "Saved legacy course" : summary.completed ? "Completed by phase-assignment criteria" : summary.started ? `Current phase: ${summary.phaseTitle ?? "In progress"}` : "Not started"}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-secondary px-2 py-1 text-xs">{!summary.course.plan ? "Saved" : summary.completed ? "Complete" : summary.started ? "Active" : "Ready"}</span>
                  </div>
                  {summary.course.plan && <p className="mt-2 text-xs text-muted-foreground">{summary.completedTopicCount} of {summary.topicCount} lessons completed · {summary.attemptCount} assessment attempt{summary.attemptCount === 1 ? "" : "s"}{summary.lastActivityAt ? ` · last activity ${new Date(summary.lastActivityAt).toLocaleDateString()}` : ""}</p>}
                  {nextTopic && <p className="mt-2 text-sm">Left off at: <strong>{nextTopic.name}</strong></p>}
                  {summary.next?.kind === "assessment" && <p className="mt-2 text-sm">Next: <strong>{summary.next.phaseTitle} assignment</strong></p>}
                  {summary.latestAttempt && <p className="mt-1 text-xs text-muted-foreground">Latest assessment: {summary.latestAttempt.evaluation.score}/{summary.latestAttempt.evaluation.maxScore} ({summary.latestAttempt.evaluation.percentage}%) · {summary.latestAttempt.evaluation.passed ? "passed" : "needs another step"}; not a mastery score.</p>}
                  <button type="button" onClick={() => {
                    setActiveCourseId(summary.course.id);
                    if (summary.next?.kind === "topic" || summary.next?.kind === "assessment") goToCourseNext(summary);
                    else {
                      setActiveTopicId(null);
                      document.getElementById("learning-journey")?.scrollIntoView({ behavior: "smooth" });
                    }
                  }} className="mt-3 rounded-md bg-secondary px-3 py-1.5 text-sm">{summary.completed ? "Review course" : summary.started ? "Resume" : "Open plan"}</button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <section id="learning-journey" className="card-paper space-y-5 p-6">
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
                <div><h3 className="text-lg font-semibold">{course.title}</h3><p className="text-sm text-muted-foreground">{course.goal}</p><p className="mt-1 text-xs text-muted-foreground">{plan.phases.every((phase) => completedPhaseIds.has(phase.id)) ? "Course complete by phase-assignment criteria; this is separate from independently demonstrated mastery." : "Phase assignments measure course progress; independent mastery is tracked separately through learning attempts."}</p></div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void startCourse(course)} className="rounded-md bg-secondary px-3 py-1.5 text-sm">{plan.phases.every((phase) => completedPhaseIds.has(phase.id)) ? "Review course" : "Resume course"}</button>
                  <button type="button" disabled={resettingCourse} onClick={() => void resetCourse()} className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50">{resettingCourse ? "Starting fresh…" : "Start fresh copy"}</button>
                  <button type="button" disabled={deletingCourse} onClick={() => void deleteCourse()} className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm text-destructive disabled:opacity-50">{deletingCourse ? "Deleting…" : "Delete course"}</button>
                </div>
              </div>
              <ul className="mt-3 flex flex-wrap gap-2">{plan.outcomes.map((outcome) => <li key={outcome} className="rounded-full bg-secondary px-3 py-1 text-xs">{outcome}</li>)}</ul>
              {!!activeSummary?.completedTopicCount && <details className="mt-3 rounded-md bg-secondary/50 p-3 text-sm">
                <summary className="cursor-pointer font-medium">Completed lessons ({activeSummary.completedTopicCount})</summary>
                <ul className="mt-2 list-disc pl-5 text-muted-foreground">{topicEntries.filter(({ topic }) => completedTopicIds.has(topic.id)).map(({ phase, topic }) => <li key={topic.id}>{phase.title}: {topic.name}</li>)}</ul>
              </details>}
              <div className="mt-5 space-y-5">
                {plan.phases.map((phase, phaseIndex) => {
                  const phaseUnlocked = plan.phases.slice(0, phaseIndex).every((previousPhase) => completedPhaseIds.has(previousPhase.id));
                  const phaseAttempts = courseAttempts.filter((attempt) => attempt.phase_id === phase.id);
                  const latestAttempt = phaseAttempts[0];
                  const objectiveQuestions = phase.assessment.objectiveQuestions ?? [];
                  const openQuestions = phase.assessment.openQuestions ?? [];
                  const assignmentKey = `${course.id}:${phase.id}`;
                  const followUpId = latestAttempt?.evaluation.followUpQuestionId;
                  const assignmentReady = phaseUnlocked &&
                    phase.topics.every((topic) => completedTopicIds.has(topic.id)) &&
                    objectiveQuestions.every((question) => objectiveAnswers[`${course.id}:${phase.id}:${question.id}`] !== undefined) &&
                    openQuestions.every((question) => (writtenAnswers[`${course.id}:${phase.id}:${question.id}`] ?? "").trim().length > 0) &&
                    (!followUpId || (followUpAnswers[`${course.id}:${phase.id}:${followUpId}`] ?? "").trim().length > 0) &&
                    readyHintStorageKey === hintStorageKey &&
                    submittingPhaseId !== `${course.id}:${phase.id}`;
                  return (
                  <section key={phase.id} className="border-l-2 pl-4">
                    <div className="flex items-start justify-between gap-2"><div><h4 className="font-semibold">Phase {phaseIndex + 1}: {phase.title}</h4><p className="text-sm text-muted-foreground">{phase.purpose}</p></div><span className="text-xs text-muted-foreground">{completedPhaseIds.has(phase.id) ? "Assessment complete" : "In progress"}</span></div>
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
                              <LearningHelper
                                context={JSON.stringify({ course: course.title, goal: course.goal, phase: phase.title, lesson: { topic: topic.name, purpose: topic.why, objectives: topic.objectives, prerequisites: topic.prerequisites.map((id) => { const entry = topicEntries.find((item) => item.topic.id === id); return entry ? { topic: entry.topic.name, explanation: entry.topic.lesson.explanation.slice(0, 500) } : { topic: id }; }), explanation: topic.lesson.explanation.slice(0, 1000), examples: topic.lesson.examples.slice(0, 2).map((example) => ({ prompt: example.prompt.slice(0, 250), walkthrough: example.walkthrough.slice(0, 400) })), practice: topic.lesson.guidedPractice.slice(0, 1).map((item) => ({ prompt: item.prompt, successCriteria: item.successCriteria })) } })}
                                numericEvidence={[courseMaterial, topic.lesson.examples.map((example) => `${example.prompt}\n${example.walkthrough}`).join("\n")].join("\n").slice(0, 3000)}
                                currentMethod="course lesson explanation and worked examples"
                                storageKey={`unstuck.helper.v1:${userId}:${course.id}:${phase.id}:${topic.id}`}
                              />
                              <button onClick={() => void completeTopic()} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Mark practice complete</button>
                            </div>
                          )}
                        </li>;
                      })}
                    </ol>
                    <details id={`phase-assignment-${assignmentKey}`} open={openAssignmentKey === assignmentKey} onToggle={(event) => {
                      if (event.currentTarget.open) setOpenAssignmentKey(assignmentKey);
                      else setOpenAssignmentKey((current) => current === assignmentKey ? null : current);
                    }} className="mt-3 rounded-lg bg-secondary/50 p-3">
                      <summary className="cursor-pointer font-medium">{phase.assessment.title} — phase assignment</summary>
                      <p className="mt-2 text-sm text-muted-foreground">{phase.assessment.purpose}</p>
                      {phase.assessment.answerToken ? (
                        <>
                          {objectiveQuestions.map((question) => {
                            const hintKey = `${course.id}:${phase.id}:${question.id}`;
                            const selectedIndex = objectiveAnswers[hintKey];
                            const selectedAnswer = selectedIndex === undefined ? null : question.options[selectedIndex] ?? null;
                            const hintShown = (usedHints[phase.id] ?? []).includes(question.id);
                            const relatedTopic = phase.topics.find((topic) => topic.objectives.some((objective) => objective.toLowerCase() === question.objective.toLowerCase()));
                            const prerequisites = relatedTopic?.prerequisites.slice(0, 2).map((id) => {
                              const entry = topicEntries.find((item) => item.topic.id === id);
                              return entry ? { topic: entry.topic.name, explanation: entry.topic.lesson.explanation.slice(0, 500) } : { topic: id };
                            }) ?? [];
                            return <fieldset key={question.id} className="mt-4 rounded-md border bg-background p-3">
                              <legend className="px-1 text-sm font-medium">{question.question} <span className="text-xs text-muted-foreground">({question.points} pts · {question.objective})</span></legend>
                              <div className="mt-2 space-y-2">{question.options.map((option, index) => <label key={option} className="flex gap-2 text-sm"><input type="radio" name={hintKey} checked={objectiveAnswers[hintKey] === index} onChange={() => setObjectiveAnswers((current) => ({ ...current, [hintKey]: index }))} />{option}</label>)}</div>
                              <button type="button" onClick={() => void markHintUsed(phase.id, question.id)} className="mt-2 text-xs text-accent underline">Show hint</button>
                              {hintShown && <p className="mt-1 text-xs text-muted-foreground">{question.hint}</p>}
                              <LearningHelper
                                context={JSON.stringify({ course: course.title, goal: course.goal, phase: phase.title, prerequisites, question: question.question, objective: question.objective, learnerAnswer: selectedAnswer, publicHint: question.hint, previousFeedback: latestAttempt?.evaluation.objectiveResults.find((result) => result.questionId === question.id) ?? null })}
                                numericEvidence={[courseMaterial, phase.topics.flatMap((item) => item.lesson.examples.map((example) => `${example.prompt}\n${example.walkthrough}`)).join("\n")].join("\n").slice(0, 3000)}
                                currentMethod="phase assignment question"
                                assessmentActive={!latestAttempt}
                                storageKey={`unstuck.helper.v1:${userId}:${course.id}:${phase.id}:${question.id}`}
                                onHintUsed={() => markHintUsed(phase.id, question.id)}
                              />
                            </fieldset>;
                          })}
                          {openQuestions.map((question) => {
                            const responseKey = `${course.id}:${phase.id}:${question.id}`;
                            const followUpPending = latestAttempt?.evaluation.followUpQuestionId === question.id;
                            const hintShown = (usedHints[phase.id] ?? []).includes(question.id);
                            const relatedTopic = phase.topics.find((topic) => topic.objectives.some((objective) => objective.toLowerCase() === question.objective.toLowerCase()));
                            const prerequisites = relatedTopic?.prerequisites.slice(0, 2).map((id) => {
                              const entry = topicEntries.find((item) => item.topic.id === id);
                              return entry ? { topic: entry.topic.name, explanation: entry.topic.lesson.explanation.slice(0, 500) } : { topic: id };
                            }) ?? [];
                            return <div key={question.id} className="mt-4 rounded-md border bg-background p-3">
                              <label className="block text-sm font-medium">{question.prompt} <span className="text-xs text-muted-foreground">({question.objective})</span><textarea maxLength={500} className="mt-2 w-full rounded-md border bg-background p-2" rows={3} value={writtenAnswers[responseKey] ?? ""} onChange={(event) => setWrittenAnswers((current) => ({ ...current, [responseKey]: event.target.value }))} /></label>
                              <button type="button" onClick={() => void markHintUsed(phase.id, question.id)} className="mt-2 text-xs text-accent underline">Show hint</button>
                              {hintShown && <p className="mt-1 text-xs text-muted-foreground">{question.hint}</p>}
                              {followUpPending && latestAttempt?.evaluation.followUpQuestion && <label className="mt-3 block text-sm font-medium">{latestAttempt.evaluation.followUpQuestion}<textarea maxLength={200} className="mt-1 w-full rounded-md border bg-background p-2" rows={2} value={followUpAnswers[responseKey] ?? ""} onChange={(event) => setFollowUpAnswers((current) => ({ ...current, [responseKey]: event.target.value }))} /></label>}
                              <LearningHelper
                                context={JSON.stringify({ course: course.title, goal: course.goal, phase: phase.title, prerequisites, question: question.prompt, objective: question.objective, learnerAnswer: writtenAnswers[responseKey] ?? null, publicHint: question.hint, followUp: followUpPending ? latestAttempt?.evaluation.followUpQuestion : null, previousFeedback: latestAttempt?.evaluation.writtenResults.find((result) => result.questionId === question.id) ?? null })}
                                numericEvidence={[courseMaterial, phase.topics.flatMap((item) => item.lesson.examples.map((example) => `${example.prompt}\n${example.walkthrough}`)).join("\n")].join("\n").slice(0, 3000)}
                                currentMethod="phase assignment question"
                                assessmentActive={!latestAttempt || (followUpPending && !(followUpAnswers[responseKey] ?? "").trim())}
                                storageKey={`unstuck.helper.v1:${userId}:${course.id}:${phase.id}:${question.id}`}
                                onHintUsed={() => markHintUsed(phase.id, question.id)}
                              />
                            </div>;
                          })}
                          <p className="mt-3 text-sm"><strong>Phase criteria:</strong> {phase.assessment.passCriteria}</p>
                          <p className="mt-3 text-xs text-muted-foreground">Complete all phase lessons first. Assessment score, phase completion, and independently demonstrated mastery are recorded separately. Hints and retries count; repeating this assignment does not establish transfer or mastery.</p>
                          <button disabled={!assignmentReady} onClick={() => void submitAssessment(phase)} className="mt-3 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{submittingPhaseId === `${course.id}:${phase.id}` ? "Grading and saving…" : "Submit assignment"}</button>
                          {phaseAttempts.map((attempt, attemptIndex) => {
                            const missedObjective = [
                              ...attempt.evaluation.objectiveResults.filter((result) => !result.correct).map((result) => result.objective),
                              ...attempt.evaluation.writtenResults.filter((result) => result.pointsEarned < result.pointsPossible).map((result) => result.objective),
                            ][0];
                            const missedTopic = phase.topics.find((topic) => topic.objectives.some((objective) => objective.toLowerCase() === missedObjective?.toLowerCase()));
                            const prerequisiteId = missedTopic?.prerequisites[0];
                            const prerequisiteTopic = topicEntries.find((entry) => entry.topic.id === prerequisiteId);
                            const reviewTopic = attempt.evaluation.recommendedAction === "prerequisite-review" ? prerequisiteTopic?.topic.name ?? missedObjective : missedObjective;
                            return <section key={attempt.attempt_id} className="mt-4 rounded-md border bg-background p-3 text-sm">
                            <h5 className="font-semibold">Attempt {phaseAttempts.length - attemptIndex}: {attempt.evaluation.score}/{attempt.evaluation.maxScore} ({attempt.evaluation.percentage}%)</h5>
                            <p className="text-xs text-muted-foreground">Hints: {attempt.hints_used} · retries before this attempt: {attempt.retry_count} · {attempt.evaluation.independent ? "independent attempt" : "supported or retaken attempt"} · assessment score is not mastery</p>
                            <ul className="mt-2 space-y-2">{attempt.evaluation.objectiveResults.map((result) => <li key={result.questionId}><strong>{result.correct ? "Correct" : "Not yet"}:</strong> {result.objective} — {result.explanation}</li>)}{attempt.evaluation.writtenResults.map((result) => <li key={result.questionId}><strong>Written response:</strong> {result.objective} — {result.pointsEarned}/{result.pointsPossible}. {result.feedback}<ul className="ml-4 list-disc">{result.criteria.map((criterion) => <li key={criterion.criterion}>{criterion.criterion}: {criterion.score}/{criterion.pointsPossible} — evidence: {criterion.evidence}</li>)}</ul></li>)}</ul>
                            <p className="mt-2 font-medium">Next step: {attempt.evaluation.recommendedAction.replace(/-/g, " ")}</p><ul className="ml-4 list-disc text-muted-foreground">{attempt.evaluation.nextSteps.map((step) => <li key={step}>{step}</li>)}</ul>
                            {attempt.evaluation.needsFollowUp && <p className="mt-2 text-accent">Your result is not marked as passed until the reasoning follow-up is reviewed.</p>}
                            {reviewTopic && !attempt.evaluation.passed && <button onClick={() => learn(`${reviewTopic} (review with a different explanation)`)} className="mt-3 rounded-md bg-secondary px-3 py-2 text-sm">Review this objective with another explanation</button>}
                          </section>;
                          })}
                        </>
                      ) : (
                        <div className="mt-3 rounded-md border bg-background p-3 text-sm">
                          <p>This saved plan predates structured assignment answer keys. Its learning work and saved progress are preserved; create a new plan to use graded phase assignments.</p>
                          {phase.assessment.tasks?.map((task) => <p key={task} className="mt-2">{task}</p>)}
                        </div>
                      )}
                    </details>
                  </section>
                  );
                })}
              </div>
            </div>
          ) : course ? <div className="rounded-lg bg-secondary p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p>This saved course uses the legacy topic format and has no structured plan. Its topics are still available:</p>
              <button type="button" disabled={deletingCourse} onClick={() => void deleteCourse()} className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm text-destructive disabled:opacity-50">{deletingCourse ? "Deleting…" : "Delete course"}</button>
            </div>
            <ol className="mt-2 list-decimal pl-5">{course.topics.map((topic) => <li key={topic.id} className="mt-1 flex items-center justify-between gap-2"><span>{topic.name} · ~{topic.minutes} min</span><button onClick={() => learn(`${topic.name} (part of: ${course.title})`)} className="rounded bg-background px-2 py-1">Review</button></li>)}</ol>
            <p className="mt-2">Create a new structured plan when you want to continue with phase lessons and saved position.</p>
          </div>
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
            {concepts.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No learning attempts recorded yet. Concepts appear here after a completed check.</p> : <ul className="mt-3 space-y-4">{concepts.map((c) => {
              const group = statusGroup(c.status);
              const rationale = group === "done"
                ? "Two clean answers in different contexts met the current criteria. This is a learning signal, not a permanent or universal mastery claim."
                : group === "developing"
                  ? "The latest recorded attempt was correct, but more clean evidence in a different context is needed."
                  : c.status === "Not assessed"
                    ? "There is not enough saved evidence to describe this concept as demonstrated."
                    : "The saved learning record indicates this concept needs another practice attempt.";
              return <li key={c.id} className="text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{c.concept}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${group === "done" ? "bg-success text-success-foreground" : group === "developing" ? "bg-secondary" : "bg-accent/20"}`}>{group === "done" ? "Demonstrated under current criteria" : group === "developing" ? "Developing" : c.status === "Not assessed" ? "Unresolved" : "Needs more practice"}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{rationale}</p>
                {group !== "done" && c.misconceptions[0] && <p className="mt-1 text-xs text-muted-foreground">Possible gap noted during diagnosis: {c.misconceptions[0]}</p>}
                <p className="mt-1 text-xs text-muted-foreground">{c.attempts} attempt{c.attempts === 1 ? "" : "s"} · {c.clean_successes} without hints · last practiced {daysSincePractice(c.updated_at, Date.now())} day{daysSincePractice(c.updated_at, Date.now()) === 1 ? "" : "s"} ago{c.review_at ? ` · next review ${new Date(c.review_at).toLocaleDateString()}` : ""}</p>
                {c.last_explanation && <button onClick={() => setOpenExplanation(openExplanation === c.id ? null : c.id)} className="mt-1 text-xs text-accent underline">{openExplanation === c.id ? "Hide" : "See"} last explanation</button>}
                {openExplanation === c.id && <p className="mt-2 whitespace-pre-line rounded-md bg-secondary p-3 text-xs">{c.last_explanation}</p>}
                <button type="button" disabled={deletingConceptId === c.id} onClick={() => void removeConcept(c)} className="mt-2 text-xs text-destructive underline disabled:opacity-50">{deletingConceptId === c.id ? "Deleting…" : "Delete this concept record"}</button>
              </li>;
            })}</ul>}
            {historyError && <p role="alert" className="mt-3 text-sm text-destructive">{historyError}</p>}
          </section>
        </div>
      </div>
      <section className="card-paper p-6" aria-labelledby="assessment-history-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><h2 id="assessment-history-heading" className="text-xl font-semibold">Assessment history</h2><p className="mt-1 text-sm text-muted-foreground">Scores show assignment performance only; they do not establish independent concept mastery.</p></div>
          {recentAttempts.length > 6 && <button type="button" onClick={() => setShowAllAttempts((shown) => !shown)} className="text-sm text-accent underline">{showAllAttempts ? "Show recent only" : `Show all ${recentAttempts.length} attempts`}</button>}
        </div>
        {recentAttempts.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No phase-assignment attempts saved yet.</p> : (
          <ol className="mt-3 divide-y">
            {recentAttempts.slice(0, showAllAttempts ? recentAttempts.length : 6).map((attempt) => {
              const attemptCourse = courses.find((item) => item.id === attempt.course_id);
              const phase = attemptCourse?.plan?.phases.find((item) => item.id === attempt.phase_id);
              return <li key={attempt.attempt_id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">{attemptCourse?.title ?? "Saved course"} · {phase?.title ?? "Phase assignment"}</p>
                  <time className="text-xs text-muted-foreground" dateTime={attempt.created_at}>{new Date(attempt.created_at).toLocaleString()}</time>
                </div>
                <p className="mt-1 text-sm">{attempt.evaluation.score}/{attempt.evaluation.maxScore} points ({attempt.evaluation.percentage}%) · {attempt.evaluation.passed ? "phase criteria met" : "more work recommended"} · {attempt.evaluation.recommendedAction.replace(/-/g, " ")}{attempt.evaluation.needsFollowUp ? " · reasoning follow-up needed" : ""}</p>
                {!attempt.evaluation.passed && attempt.evaluation.nextSteps.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Recommended: {attempt.evaluation.nextSteps.join(" ")}</p>}
              </li>;
            })}
          </ol>
        )}
      </section>
      {importedGuestActivity.length > 0 && (
        <section className="card-paper p-6" aria-labelledby="guest-history-heading">
          <h2 id="guest-history-heading" className="text-xl font-semibold">Imported guest activity</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These answers were saved on this device before sign-in. They are kept for continuity but are unverified
            and do not count as demonstrated knowledge or change your course progress.
          </p>
          <ol className="mt-3 divide-y">
            {importedGuestActivity.slice().sort((a, b) => Date.parse(b.saved_at) - Date.parse(a.saved_at)).slice(0, 10).map((item) => (
              <li key={item.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                <span>{item.record.concept} · {item.record.correct ? "guest recorded correct" : "guest recorded incorrect"} · not assessed</span>
                <time className="text-xs text-muted-foreground" dateTime={item.saved_at}>{new Date(item.saved_at).toLocaleDateString()}</time>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
