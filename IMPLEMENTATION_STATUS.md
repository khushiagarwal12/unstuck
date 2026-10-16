# UNSTUCK: current implementation status

Update date: 2026-10-16. Worktree branch: `khushiagarwal12-unstuck-auth-diagnostics`.
Scope: authentication/user continuity and diagnostic-learning changes. No deployment, push, commit, billing change,
or provider migration was performed. The historical audit below describes the earlier baseline and is not a report
of this worktree's validation.

## Current phase: end-of-phase assessment and adaptive progression

The assessment lifecycle is implemented in the current worktree but has not been deployed, committed, or pushed.
It reuses the existing course plan, Supabase Postgres/RLS, authenticated server functions, and current AI provider.
The assessment migration is pending application.

### Behavior implemented

- Every newly generated phase includes objective and open-ended assignment questions tied to its objectives, point
  values, hints, explanations, explicit reference criteria, and a rubric. Objective keys are independently solved
  before a plan is returned; generation retries once and fails rather than serving an unverified key.
- Public course plans omit objective answer indices/explanations and open-response criteria/rubrics. These are
  encrypted into a phase token using the existing `QUESTION_SIGNING_SECRET` mechanism and evaluated server-side.
- Objective questions are graded deterministically. Open answers use the existing provider against explicit
  criteria; the returned rubric names, point caps, response evidence quotes, totals, and progression state are
  validated with Zod. The grader has no confidence field and cannot award rubric credit without a quote present in
  the learner's answer.
- Results include objective correctness and explanations, rubric scores/evidence/feedback, total score,
  recommended action, and next steps. An ambiguous explanation can trigger a targeted follow-up and blocks phase
  completion until the learner responds. At 80% the learner can advance; 50–79% recommends targeted remediation;
  below 50% recommends prerequisite review. Hints or retakes prevent a passing result from being described as
  independent. Assessment scores never update concept mastery.
- The UI requires lessons and required assignment answers, exposes hints/follow-up prompts, shows attempt history,
  and offers remediation guidance. New-plan phase completion is derived from saved passing attempts, not editable
  client progress fields. The grading handler also checks saved topic completion and passing results for all prior
  phases before accepting a submission. Existing completed topics and course plans are preserved.
- Attempts are append-only for authenticated clients, scoped by RLS on reads, and written only by the authenticated
  server handler after validating the bearer identity, owned course, course phase, answer token, response shape,
  and evaluation. The server uses the existing service-role client and supplies the owner from verified auth
  context. A stable browser submission UUID plus a unique `(user_id, attempt_id)` key makes retries idempotent.

### Files changed in this phase

- `src/lib/course-assessment.ts` (new): assignment/grade schemas, rubric-evidence validation, deterministic scoring,
  independent-vs-supported distinction, and adaptive decisions.
- `src/lib/course-assessment.functions.ts` (new): authenticated assessment grading and idempotent server-side
  persistence.
- `src/lib/course-assessment.server.ts` (new): answer-key/reference-criteria protection in course plans.
- `src/lib/answer-key.server.ts`: long-lived encrypted course-assignment tokens.
- `src/lib/tutor-core.ts`, `src/lib/tutor-prompts.ts`, `src/lib/tutor-schemas.ts`, `src/lib/tutor.functions.ts`:
  required generated phase assignments, verified objective keys, and public-plan protection.
- `src/routes/index.tsx`: assignment interaction, bounded responses, hints, follow-ups, feedback/history,
  remediation, and attempt-derived phase completion.
- `src/integrations/supabase/types.ts`: assessment-attempt table types.
- `drizzle/migrations/0003_course_assessment_attempts.sql` (new): append-only attempt table, client read-only grants,
  and owner-scoped RLS.
- `src/test/course-assessment.test.ts` (new), `src/test/course-plans.test.ts`,
  `src/test/tutor-core.test.ts`, `src/test/answer-key.test.ts`: scoring, evidence validation, ambiguous reasoning,
  hints/retakes, plan personalization, key protection, and independent key verification.
- `supabase/tests/0003_course_assessment_attempts.test.sql` (new): own-user read, cross-user isolation, duplicate
  persistence behavior, and client write restrictions.
- `IMPLEMENTATION_STATUS.md`.

### Verification, setup, and limitations

- `git diff --check`: passed after the assessment changes.
- Targeted Vitest (`src/test/course-assessment.test.ts`, `src/test/course-plans.test.ts`,
  `src/test/tutor-core.test.ts`, `src/test/answer-key.test.ts`): attempted; `npm test -- --run ...` exited 1
  because `vitest` is not installed (`'vitest' is not recognized...`), so no tests executed.
- Production build: attempted; `npm run build` exited 1 because `vite` is not installed (`'vite' is not
  recognized...`), so no build executed. Typecheck and lint were not run because the local project
  toolchain/dependencies are absent.
- The pgTAP persistence/RLS test and migration were not run/applied; Supabase CLI and `psql` are unavailable.
  No database was accessed. No dependency install was attempted.
- Before release, apply `drizzle/migrations/0003_course_assessment_attempts.sql` after
  `0002_structured_courses.sql` using the existing Supabase migration process. Existing server configuration must
  retain `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, and `QUESTION_SIGNING_SECRET`; the current AI provider is
  reused. Google/Firebase setup is unchanged and not part of this phase.
- Subjective grading remains provider-assisted rubric interpretation, not a formal proof of understanding; strict
  schemas and evidence quotes constrain it but do not make it infallible. Assessment completion is distinct from
  independently demonstrated concept mastery. Existing course plans generated before phase assignments remain
  legacy plans and do not acquire graded assignments automatically. Hint-use and completed-lesson state are
  learner actions and are not proctored evidence. Rotating the answer-signing secret invalidates existing
  assignment tokens.
- No deployment, commit, or push was performed.

## Current phase: personalized structured courses

Course-generation changes are implemented in this worktree; dependency and database tooling are unavailable for
runtime verification. No deployment, commit, or push was performed for this phase. It reuses the current tutor
server function/provider, Supabase Postgres, and existing per-user RLS; it does not add another AI provider or
database.

### Architecture and behavior implemented

- Course replies are validated as a phased `CoursePlan`: objectives, subtopics, prerequisite topic IDs, lessons,
  worked examples, guided practice, and end-of-phase assessment tasks/rubrics/pass criteria are required.
- The generation context includes the learner's goal, profile pace/level, recorded attempts and misconceptions,
  concepts demonstrated under current criteria, supported gaps, and optional pasted or photo-transcribed material.
  The prompt distinguishes self-report from observed performance and asks for scaffolded conceptual, applied, and
  reasoning work.
- A generated course is shown as a proposal before it is saved. Starting it creates a new course row, leaving older
  plans intact. The structured plan is stored in `courses.plan`; learner-specific position and completed topics
  are stored separately in `course_progress`. Graded phase attempts and their histories are stored in the
  append-only `course_assessment_attempts` table.
- The player presents lessons, examples, practice hints/criteria, and phase assessments. It saves position and
  responses and blocks forward navigation over unmet topic prerequisites and incomplete earlier phases. A learner
  can skip a topic only when all covered concepts have recorded demonstrated status and at least two clean
  successes; self-report does not skip it.
- RLS on `course_progress` requires the authenticated user to own both the progress row and its course. Existing
  legacy courses remain visible with their original topic review flow.

### Files changed in this course phase

- `src/lib/tutor-schemas.ts`
- `src/lib/tutor-prompts.ts`
- `src/routes/index.tsx`
- `src/integrations/supabase/types.ts`
- `drizzle/migrations/0002_structured_courses.sql`
- `src/test/tutor-core.test.ts`
- `src/test/course-plans.test.ts`
- `supabase/tests/0002_structured_courses.test.sql`
- `IMPLEMENTATION_STATUS.md`

### Verification and limitations

- `git diff --check`: passed.
- Targeted Vitest run (`src/test/course-plans.test.ts`, `src/test/tutor-core.test.ts`): **not run**; the command
  failed because `vitest` is not installed (`node_modules` is absent). The new test checks distinct diagnostic
  contexts produce distinct, schema-valid course plans through the existing tutor pipeline and covers course
  personalization inputs; it does not prove a live model always responds appropriately.
- Production build: **not run**; `vite` is not installed. Typecheck: **not run**; TypeScript is not installed.
- SQL persistence/RLS pgTAP coverage was added in `supabase/tests/0002_structured_courses.test.sql` but was not run;
  `supabase` CLI and `psql` are not installed and no live database was accessed. The migration has not been applied.
- Lesson completion is an explicit learner action; the existing tutor session is not yet tightly coupled to course
  lesson completion. A manually transcribed or photo-read source material excerpt informs generation but is not
  retained as a separately cited source in the saved plan. See the current assessment phase above for new-plan
  assignment grading and the legacy-plan limitation.

### Setup and prioritized follow-up

1. Apply `drizzle/migrations/0002_structured_courses.sql` and then
   `drizzle/migrations/0003_course_assessment_attempts.sql` through the existing Supabase/Drizzle migration
   process before using course progress and assessment queries; then run both pgTAP tests.
2. Install project dependencies in an environment where the configured package manager can resolve the lockfile,
   then run the targeted Vitest tests, full tests, typecheck, lint, and production build. The prior documented
   `npm install` resolver error remains unresolved; no install was retried here.
3. Manually verify course generation and progress recovery against configured Supabase and the existing tutor
   provider. Photo material is available only when the existing Google/Gemini vision capability is configured.
4. Consider server-side grade validation or course-lesson attempt linkage in a later phase. Avoid regenerating or
   mutating an active course automatically; current regeneration creates a separate saved course to preserve prior
   work.

## Current phase: authentication continuity and diagnostic learning

### Architecture in this worktree

- Authentication remains Lovable Auth over Supabase; Google OAuth is still the configured sign-in path. Firebase is
  not used or introduced.
- Profiles, courses, and concepts remain in Supabase Postgres with the existing per-user RLS policies. The guest
  progress import is a verified-auth server function; its database function derives the owner from `auth.uid()` and
  never accepts a client-supplied owner id.
- Guest progress and unfinished learning-session state are stored in browser local storage. Google sign-in imports
  completed guest attempts into the authenticated account atomically and idempotently, then adopts an unfinished
  guest session into the user's local session slot if that slot is empty.
- Diagnostic and transfer answer keys are removed from responses to the browser. The server issues an encrypted,
  expiring token and checks the submitted choice; transfer explanations are released only after submission.
- AI generation remains in the existing server-only tutor functions and provider module. The learning flow now
  records diagnostic correctness before generating a tentative diagnosis, and course creation is gated on at least
  one completed diagnostic/practice attempt.

### Files changed

- `.env.example`
- `drizzle/migrations/0001_guest_progress_import.sql`
- `src/components/LearnSession.tsx`
- `src/integrations/supabase/types.ts`
- `src/lib/answer-key.server.ts`
- `src/lib/guest-progress.ts`
- `src/lib/progress.functions.ts`
- `src/lib/session-storage.ts`
- `src/lib/tutor.functions.ts`
- `src/lib/tutor-prompts.ts`
- `src/lib/tutor-schemas.ts`
- `src/routes/index.tsx`
- `src/test/answer-key.test.ts`
- `src/test/guest-progress.test.ts`
- `src/test/session-storage.test.ts`
- `src/test/tutor-core.test.ts`
- `supabase/tests/0001_auth_and_guest_progress.test.sql`
- `IMPLEMENTATION_STATUS.md`

No dependency manifest or lockfile was changed.

### Implemented behavior

- The homepage explicitly offers **Continue with Google** and **Continue as Guest**. Sign-in start failures, provider
  cancellation, auth initialization failures, sign-out failures, and an ended auth session have visible messages.
- Guest completed attempts persist locally and are shown in the guest banner. Local conversion batches have stable
  conversion IDs; the SQL function records a per-user receipt and merges concepts in the same transaction, preventing
  duplicate imports on retry. RLS and the function use the verified Supabase identity for ownership.
- Guest and signed-in unfinished sessions are persisted locally. A guest's active session is transferred into the
  signed-in user's local session slot only when that user has no saved session already.
- Diagnostic and transfer answer indices are no longer returned by the tutor server function. An encrypted answer token
  expires after 24 hours; transfer explanation text is returned by the answer checker only after submission.
- Diagnosis now runs after either a correct or incorrect first response. Prompts distinguish self-report from
  observed answers, require tentative claims under uncertainty, account for disputed hypotheses, and request
  discriminating follow-ups. Confidence is capped at low with fewer than two observed answers, medium with two, and
  hypotheses explicitly disputed by the learner are capped at low. The result separates demonstrated knowledge,
  likely hypotheses, and unresolved questions.
- A personalized course cannot be generated until the learner has completed one diagnostic/practice attempt; course
  prompts use observed diagnostic and demonstrated-concept evidence when available.

### Verification results

- **Unit tests:** not run. `npm test -- --run` could not find `vitest`.
- **Build:** not run. `npm run build` could not find `vite`.
- **Typecheck:** not run. `node_modules/.bin/tsc.cmd` is absent.
- **Dependency installation:** Bun is unavailable. `npm install --no-package-lock` failed in npm's resolver with
  `Cannot read properties of null (reading 'edgesOut')`; dependencies remain unavailable. No test/build/typecheck
  result is claimed as passing.
- **Database tests:** `supabase/tests/0001_auth_and_guest_progress.test.sql` adds pgTAP coverage for anonymous import
  rejection, authenticated import, idempotent retry, and cross-user read/write denial. It was not run because the
  database tooling/dependencies are unavailable and no live database was inspected.
- **Repository state:** read-only change overview showed no changes before implementation and shows the tracked
  implementation diff now. Git shell status/history commands were denied by the environment, so exact HEAD/status
  could not be independently confirmed after editing. No commit or push was made.

### Setup required before deploying this phase

- Generate a random `QUESTION_SIGNING_SECRET` of at least 32 characters (for example, `openssl rand -base64 32`) and
  configure it as a server-side secret in the existing Lovable/Cloud Run environment. Never expose it as a `VITE_`
  variable. Without it, question-answer verification fails closed.
- Apply `drizzle/migrations/0001_guest_progress_import.sql` to the configured Supabase database using the project's
  existing Drizzle migration process before relying on guest conversion.
- Enable/configure Google OAuth in the existing Lovable Auth project and allow the deployed app's callback/redirect
  URL. No Firebase project or Firebase-specific setup is required for this stack.

### Prioritized remaining work and limitations

1. Apply the database migration and run the new pgTAP tests plus the Vitest suite, typecheck, and production build in
   an environment with the project dependencies and configured Supabase database.
2. Configure `QUESTION_SIGNING_SECRET` and manually verify Google OAuth success/cancel, expired sessions, guest
   conversion, and returning-user session recovery against the deployed Lovable Auth/Supabase setup.
3. Guest progress and active-session snapshots are device/browser-local until Google sign-in; clearing browser
   storage before conversion loses that local-only data. Signed-in course/progress records are cloud-backed, while
   unfinished learning-session snapshots currently remain local to that browser rather than syncing across devices.
4. Answer-token replay prevention caches the first submitted choice/result in memory per process (same-choice
   retries are idempotent). Serverless instances do not share that cache; a durable one-use token store is needed if
   cross-instance replay resistance is required.
5. Aggregate attempts, hints, and outcomes persist, but detailed answer-by-answer diagnostic/follow-up history is
   not yet retained in cloud storage after an active session is finished.
6. Signed-in profile/concept/course CRUD outside guest conversion still uses direct Supabase client calls protected
   by the existing RLS rules. Those policies constrain ownership, but no live cross-user database integration run
   was possible here.
7. A single diagnostic response is intentionally insufficient for high-confidence hypotheses; additional evidence
   and learner challenges should continue to be surfaced as uncertainty, not treated as confirmed misconceptions.

---

# Historical architecture audit (baseline)

Audit date: 2026-10-16. The earlier audit inspected `main` at `9aef5cf` (reported equal to `origin/main` then).
It was a read-only audit; its build/test results and assumptions are historical and are not validation of the current
worktree changes. Cloud consoles and the live service were not reached during that audit.

Legend: **Verified** = seen in the repo or reproduced locally. **Assumption** = not checked, or reported by someone.

---

## 1. Summary

The product is now a different stack from the Google-services-maximized design in `09dd632`.
Commit `9e5e09c` ("...with Lovable Cloud backend") deleted the FastAPI backend, the Firebase/Firestore layer, the
document pipeline, the tested learning-loop core and the old frontend, and replaced them with a Lovable-generated
TanStack Start app that uses **Supabase (Lovable Cloud) for data, Lovable auth for Google sign-in, and a Lovable
build/hosting setup**. My later commits (`e8e3564`, `9aef5cf`) moved the AI to Gemini and added Vertex AI, Text-to-Speech,
Translation, YouTube and a Cloud Run Dockerfile, but they sit on top of the Lovable foundation.

Result: AI and optional Google APIs are Google. Auth, database, build and default hosting are not, and several
quality guarantees from the earlier design no longer exist in the running code.

---

## 2. Architecture

### Intended (design at `09dd632`, plus the audit brief)
```
Browser (React + TS)
   | Firebase Auth (Google sign-in) -> ID token
   v
Cloud Run (one container)
   |-- API (FastAPI in 09dd632)  -> verifies Firebase ID token, owns the learning loop
   |-- Vertex AI (Gemini, ADC)   -> primary;  AI Studio key only as fallback
   |-- Firestore                 -> profiles, courses, mastery, sessions (rules by uid)
   |-- Cloud Storage             -> only if uploaded documents must be kept
   '-- Optional: Text-to-Speech, Translation, Vision
```

### Actual (verified)
```
Browser (React 19 + TS, TanStack Start SSR)
   | Lovable auth (@lovable.dev/cloud-auth-js) -> Supabase session
   |-- reads/writes Supabase tables DIRECTLY from the browser (profiles, concepts, courses; RLS by user id)
   v
TanStack Start server functions (same app, no separate API)
   |-- askTutor, readProblem, speakText, translateLesson, findConceptVideo   (NO sign-in check; per-IP limits)
   |-- Provider chain:  LLM_BACKEND=vertex -> Vertex AI
   |                    else GEMINI_API_KEY  -> Gemini API (AI Studio)   <- default today
   |                    else LOVABLE_API_KEY -> Lovable gateway (OpenAI "gpt-6-astra")   <- non-Google
   '-- Google APIs by API key or service account: Text-to-Speech, Translation, YouTube Data
Build: @lovable.dev/vite-tanstack-config -> nitro preset cloudflare-module (default)
Hosting: Lovable publish (Cloudflare Workers, assumed). Dockerfile for Cloud Run exists but is untested and undeployed.
```

---

## 3. Intended versus actual

| Area | Intended | Actual (verified unless noted) | Status |
|---|---|---|---|
| Frontend | React + TypeScript | React 19, TS 5.8, Vite 8.1.5, TanStack Start 1.168, Tailwind 4, shadcn/Radix | OK. Framework changed from plain Vite SPA to SSR |
| Build tooling | Plain Vite | `@lovable.dev/vite-tanstack-config` 2.26.5 wraps Vite and defaults the server build to Cloudflare | Lovable-induced |
| AI primary | Gemini on Vertex AI, project `unstuck-e6012`, `us-central1` | Vertex only if `LLM_BACKEND=vertex`; **default is the Gemini API key**; no project id is set anywhere in the repo; region defaults to `us-central1` | Partial |
| AI fallback | AI Studio key only | Third fallback is the **Lovable gateway (OpenAI model)** | Unintended substitution |
| Auth | Google sign-in via Firebase Auth | Lovable auth wrapper over Supabase; no Firebase code in the tree | Not as intended |
| Server-side identity | API verifies the ID token | Server functions do **not** verify the token (a Supabase middleware exists but is unused) | Gap |
| Backend | Python FastAPI on Cloud Run | Server functions inside the TanStack Start app; FastAPI removed (still in history at `09dd632`) | Changed |
| Database | Firestore with uid rules | Supabase Postgres (Lovable Cloud), tables `profiles`, `concepts`, `courses`, RLS per user | Not Google |
| Mastery / progress | Computed and stored by the backend from attempts | Computed in the browser and written directly by the learner's own session; a learner can set their own status | Integrity gap |
| Learning loop | Pure, tested Bayesian posterior + state machine + policy (50+ tests) | LLM states hypotheses and confidence; follow-up limit enforced in `normalize`; no posterior | Regressed |
| Answer keys | Never sent to client before answering | `correctIndex` is returned to the browser (verified by a second solve, but visible) | Regressed |
| Documents | Upload PDF/photo/paste, chunk, embed, cite sources | Not present. Only a notes textarea (6,000 chars) and photo-to-text (in memory) | Feature removed |
| File storage | Cloud Storage only if needed | None. Nothing is stored, which matches "process in memory" | OK for now |
| Hosting | Cloud Run | Default build is Cloudflare. `Dockerfile` (node-server preset) builds and runs under Node locally; **Docker image not built, nothing deployed**. The old Cloud Run URL did not respond from the sandbox (**Assumption**: network allowlist, state unknown) | Unverified |
| Speech / translation / vision | Only where it adds learning value | Gemini photo reading, Cloud Text-to-Speech, Cloud Translation (9 languages), YouTube search; each hides itself without credentials | OK |
| Abuse limits | Per-user daily caps, judge code | Per-IP in-memory limiter per instance only | Weaker |
| Tests | Backend suite + evals | 26 Vitest tests pass (verified now). The backend suite and `evals/` are gone. `tsc` reports 4 errors, all in Lovable-generated `src/routes/index.tsx` | Reduced |

---

## 4. Lovable-induced changes

Verified in the tree:
- **Packages:** `@lovable.dev/cloud-auth-js`, `@lovable.dev/vite-tanstack-config`, plus Supabase and database tooling (`@supabase/supabase-js`, `drizzle-orm`, `drizzle-kit`, `postgres`).
- **Files:** `src/integrations/lovable/`, `src/integrations/supabase/` (7 files), `src/lib/lovable-error-reporting.ts`, `supabase/config.toml`, `drizzle/`, `drizzle.config.ts`, `.lovable/project.json` (tracked), tracked `.env` with the Supabase project URL and publishable key, `bunfig.toml` (Lovable exceptions), `bun.lock` (points at Lovable's npm cache; an install failed with HTTP 403 in the sandbox).
- **Code paths:** `lovable.auth.signInWithOAuth` in `src/routes/index.tsx`; `reportLovableError` in `src/routes/__root.tsx`; `lovableGenerate` and the `LOVABLE_API_KEY` branch in `src/lib/ai-provider.server.ts`; `attachSupabaseAuth` in `src/start.ts`.
- **Docs:** `AGENTS.md` has a Lovable block that tells contributors not to rewrite history. README says "Google sign-in" without saying it goes through Lovable.
- **Dead weight:** 54 runtime dependencies. Nine UI libraries (embla-carousel, input-otp, react-day-picker, recharts, vaul, cmdk, sonner, react-resizable-panels, react-hook-form) are not imported outside their `components/ui` wrappers.
- **Duplicated services:** two AI routes (Vertex and Gemini API, plus the Lovable gateway), two possible auth paths (Lovable/Supabase now; Firebase only in history), two build targets (Cloudflare default, Node via Dockerfile).
- **Broken or fragile:** Google sign-in depends on Lovable's redirect allowlist, so it may not work on a Cloud Run or localhost origin (**Assumption**, untested). Server functions are open to anyone who can reach the URL.

---

## 5. Secrets and exposure

- **Verified:** no private key, service-account JSON or AI Studio key (`AQ.Ab8…`) in any commit. The Firebase web API key from the earlier setup appears in old build bundles and one earlier `.env.example` (public identifier by design). The tracked `.env` holds only Supabase's publishable values.
- **Assumption:** the Gemini key pasted in an earlier chat message has not been rotated yet. Rotate it.

---

## 6. Recommendations (smallest safe changes first)

**P0: safety, no architectural decision needed**
1. Rotate the leaked Gemini key and confirm no key is set in a tracked file.
2. Require a verified identity on the server functions, or accept guest use but with a stricter limit for anonymous callers and a global daily cap. Smallest change: apply the existing (unused) auth middleware to `askTutor` and the Google API functions, with a separate low-limit guest path.
3. Stop letting the browser set mastery directly: record each attempt through a server function that computes status from attempts (the old `mastery.py` rule is in history), or at minimum validate the status transition server-side.
4. Stop returning `correctIndex` before the learner answers: return a signed question token and check answers on the server.

**P1: restore the intended Google architecture**
5. **Decision for you first:** where learner data and sign-in should live.
   - Option A, smallest: keep Supabase/Lovable short term and fix only AI, hosting and security (items 6–8).
   - Option B, intended: Firebase Auth (Google) + Firestore with rules by uid. About 13 call sites in `src/routes/index.tsx` touch Supabase, so the swap is contained behind one data module. Recommended, done after items 1–4 and 6–8.
6. Make Vertex AI the primary provider: use Vertex when `GOOGLE_CLOUD_PROJECT` is set, keep the Gemini API key as the only fallback, and delete the Lovable gateway branch. On Cloud Run, use the runtime service account (metadata server) instead of a long-lived JSON key.
7. Pick one hosting target and make the build explicit. If Cloud Run: run `docker build` once, deploy to a test service, and check `/` and one server function. Replace the Lovable Vite wrapper with an explicit Vite config only when the Lovable removal is approved.
8. Add `GOOGLE_CLOUD_PROJECT=unstuck-e6012` and `GOOGLE_CLOUD_LOCATION` to deployment config (not code) once confirmed.
9. Decide whether document upload with citations is still in scope. If yes, restore it from `09dd632` behind the same server-function boundary. Cloud Storage is only needed if originals must be kept; today processing in memory is enough.
10. Port the deterministic core (posterior, mastery, state machine) and its tests from `09dd632` to TypeScript, or run it as a small Cloud Run service. Without it, hypotheses are the model's own stated confidence.

**P2: hygiene (after the decisions above)**
11. Remove Lovable files, packages and docs listed in section 4, the unused UI libraries, and `.env` from tracking; rewrite `AGENTS.md`; add `.env.example` entries for whichever backend is chosen.
12. Fix the 4 type errors, and add the lint and test run to CI.
13. Keep Gemini photo reading, Text-to-Speech, Translation and YouTube: they add real value (accessibility, Indian-language learners) and need only a restricted API key.

**Open items I could not verify (Assumptions)**
- Whether the old Cloud Run service (`unstuck-api-783684471532…`) is still running and which code it serves.
- State of the Firebase project `unstuck-e6012` (Auth providers, Firestore, rules) and of the Supabase project created by Lovable Cloud.
- That the Vertex AI, Text-to-Speech, Translation and YouTube APIs are enabled, and that the default model names exist in your project.
- That a Docker build of this repo succeeds.
- Whether Lovable still auto-publishes from this repository.

## 7. Historical audit disposition
- The earlier request to "Discard Lovable from everywhere" was paused pending an architecture decision. This task
  explicitly requires preserving the configured provider; the current changes therefore keep Lovable Auth/Supabase
  and do not attempt a Firebase migration.
- Historical audit recommendations remain contextual and should not be mistaken for work completed in this phase.
