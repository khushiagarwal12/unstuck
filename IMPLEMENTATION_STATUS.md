# UNSTUCK implementation status

Updated: 2026-10-17
Integration branch: `firebase-firestore-integration`
Baseline: `khushiagarwal12-unstuck-auth-diagnostics` at `a5fc8fe`

## Verification update (2026-10-17)

Fixes made after an independent review of commit `a5a263c`:

- **Production build:** `auth-middleware.ts` pulled `firebase-admin` and `@tanstack/react-start/server` into the browser
  bundle and failed import protection. Token reading now lives in `auth-user.server.ts`; the middleware imports it lazily.
- **Node server output:** the explicit Vite config had no Nitro plugin, so no `.output/server/index.mjs` existed for the
  Dockerfile. `nitro()` is restored (`NITRO_PRESET` overrides, default `node-server`).
- **Installs:** `package-lock.json` was out of sync and lacked a Linux `rolldown` binding; a plain `npm install` crashed with an
  npm resolver error. The lockfile is regenerated and `.npmrc` sets `legacy-peer-deps=true`, which avoids the crash.
- **Assignment hints:** `saveAssessmentHint` was defined in `SignedIn` but used in `Dashboard`, so every hint request failed with
  a ReferenceError. The hook now lives in `Dashboard`.
- **Tests:** fixed stale tests (third `validateSubjectiveGrades` argument, new `context` field, interleaved verification prompt)
  and a wrong 50% expectation in the "targeted remediation" case that had never executed.

Verified in the sandbox (Node 22.22, npm 10.9): `vitest run` 69/69 pass; `vite build` succeeds and writes
`.output/server/index.mjs`; that server started and answered `GET /` with 200.

Not verified: sign-in against a real Firebase project, Firestore reads/writes and rules (the emulator could not be
downloaded here), Vertex AI calls, a Docker image build, and any browser interaction. `tsc --noEmit` still reports 107 errors
(mostly strict-mode style; about 25 substantive, in `index.tsx`, `LearnSession.tsx`, `LearningHelper.tsx`,
`workspace.functions.ts`, `answer-key.server.ts`, `shared-limits.server.ts`). The build does not type-check.

Known gaps: `saveCourse` stores the plan the browser sends, so a learner can edit their own phase gating (sealed assignment
questions are unaffected); guest rate limiting trusts the first `X-Forwarded-For` value, which is likely spoofable on Cloud Run.

## Hardening update (2026-10-17, second pass)

- **Type check clean:** `tsc --noEmit` now reports 0 errors (was 107). `noPropertyAccessFromIndexSignature` was turned off
  (style only; it flagged `process.env.X` access). The remaining fixes were real typing issues, plus one real bug:
  `startCourse` used a `{phase, topic}` entry as a topic, so resuming at a saved lesson position lost the lesson id.
- **Signed course plans:** `askTutor` now returns a `planSignature` (HMAC-SHA256 with the active signing key) for generated plans.
  `saveCourse` verifies it and derives title, goal, outcomes and topics from the signed plan, so learners cannot edit phase
  gating or prerequisites before saving. Courses saved before this change have no signature and cannot be copied with
  "Start fresh copy" (the UI says to build a new plan).
- **Guest rate limits:** the client IP is now the `X-Forwarded-For` entry appended by the trusted proxy (counted from the end,
  `TRUSTED_PROXY_HOPS`, default 1). `CF-Connecting-IP` is ignored unless `TRUST_CF_CONNECTING_IP=true`.
- **Tests:** 75 pass (6 new: signature accept/tamper/rotation, client-address cases). `vite build` succeeds and the built server
  answers `GET /` with 200.

Still unverified: real Firebase sign-in, Firestore reads/writes and security rules (no emulator available here), Vertex AI
calls, a Docker image build, and browser interaction. Firestore TTL policies and signing keys still need manual setup.

## Scope and status

This work replaces the Lovable Auth/Supabase persistence foundation with Firebase Authentication, Cloud Firestore,
and Gemini on Vertex AI while retaining the existing learning flows. No existing Supabase learner data is migrated,
as requested. This branch is pushed to GitHub. No deployment, billing change, or cloud resource change was performed.

The code paths and local test suite are being updated. Live Firebase/Google Cloud behavior cannot be verified
without project credentials and configured services; the application is not ready for a controlled demo until the
checks and manual configuration below are completed.

## Current architecture

- **Authentication:** Firebase Web Auth with Google popup sign-in. Global TanStack function middleware attaches a
  Firebase ID token after Auth restores its browser state. Protected handlers verify the token (including revocation
  checks) through Firebase Admin and use only the verified UID for ownership.
- **Persistence:** Cloud Firestore through Firebase Admin SDK/ADC. Documents are scoped beneath `users/{uid}`.
  Browser Firestore access is denied by `firestore.rules`; no client-supplied owner ID controls a server query.
- **Learning state:** Profiles, concepts, saved personalized course plans, course position, assignment attempts,
  hint records, verified learning attempts, and imported guest activity are Firestore-backed. Course structure is
  saved separately from mutable course position and append-only assignment history. Client-submitted grades,
  mastery state, and completed phase IDs are not trusted.
- **Guest continuity:** The diagnostic/practice experience remains available without Firebase configuration, with
  local-storage progress. On Google sign-in, completed guest events import idempotently under the verified UID;
  their claims are retained as explicitly unverified history and cannot promote mastery. The unfinished session is
  adopted locally only when the account has no existing session.
- **AI:** Gemini calls use Vertex AI via Google ADC from the server-only provider module. No Gemini or other model
  calls are made from the browser. Structured tutor replies continue to be schema-validated; private assessment
  criteria and answer keys remain server-side.
- **Answer-key integrity:** AES-GCM answer tokens use a configurable key ring with key IDs and expiry. Diagnostic
  and transfer tokens expire after 24 hours; course assignment tokens expire after 10 years to preserve saved
  assignments. Firestore replay receipts and shared request counters support cross-instance idempotency/rate limits;
  Firestore TTL is only cleanup and must be configured separately.
- **Hosting:** Vite/TanStack Start is configured for a Node server build used by the Cloud Run Dockerfile. The Firebase
  web app config is public build-time configuration; runtime signing keys use Secret Manager.

## Implementation changes

- Added `src/integrations/firebase/client.ts`, `admin.server.ts`, `auth-middleware.ts`, and `auth-attacher.ts` for
  Google sign-in, ADC-backed Admin services, bearer-token verification, and TanStack function auth.
- Added `firestore.rules` and `firebase.json`; direct client access is deny-all.
- Added `src/lib/workspace.functions.ts` for UID-scoped profile/course/progress/concept/hint/guest-history
  operations. Course phase completion is derived from saved passing assignment attempts. Imported guest records are
  shown separately as unverified.
- Reworked `src/lib/course-assessment.functions.ts` to derive ownership from verified auth, validate saved course
  assignment tokens, grade server-side, persist attempts transactionally, track hints, and advance progress only
  from passing results.
- Added `src/lib/answer-replay.server.ts`, `shared-limits.server.ts`, and `learning-evidence.server.ts` for shared
  replay/rate-limit state and server-derived verified-answer evidence.
- Updated `src/lib/answer-key.server.ts` for key IDs/rings, expiry, and compatible decryption of still-valid
  tokens; updated course assessment signing to the key-ring configuration.
- Replaced the Gemini/Lovable gateway selection with Vertex Gemini in `src/lib/ai-provider.server.ts`; changed
  `src/lib/google-auth.server.ts` to ADC instead of service-account JSON signing. Optional Google APIs remain in
  `src/lib/google-apis.server.ts` and use API keys or ADC.
- Migrated `src/routes/index.tsx` and `src/components/LearnSession.tsx` / `LearningHelper.tsx` to Firebase Auth and
  Firestore-backed server functions while keeping guest access, structured courses, assignments, dashboard,
  helper, and progress flows.
- Replaced the Lovable Vite wrapper with standard Vite/TanStack/React/Tailwind plugins; updated Node Cloud Run
  container configuration and ignored local environment files.
- Removed Supabase/Lovable source integrations, browser Supabase progress handlers, Drizzle/Postgres migrations and
  schemas, Supabase tests/config, Lovable-specific build dependency/config, and Bun lock/config. Removed `.env` from
  Git tracking while preserving the local file; its contents were not inspected.
- Replaced old environment/setup instructions with `.env.example`, `docs/GOOGLE_SETUP.md`, `README.md`, and this
  status report. Added/updated auth, guest-import, Vertex/ADC, and key-rotation tests.

## Validation performed

| Check | Result |
|---|---|
| Branch/worktree inspection | Branch is `firebase-firestore-integration`; changes are isolated from the feature baseline. |
| `.env` handling | Removed from the Git index; local file remains and was not read or printed. |
| `git diff --check` | Passed after the latest edits. |
| Dependency installation | A shallow install completed but did not install all required packages. A subsequent `npm ci --no-audit --no-fund --legacy-peer-deps` stalled for over seven minutes with no progress and was stopped. Local Node is v22.12.0, below the declared Node >=22.13.0 engine. |
| Unit tests | Attempted with the incomplete shallow install; Vitest failed during startup (`SyntaxError: Missing initializer in const declaration`). No test assertions ran. |
| Typecheck | Attempted with the incomplete shallow install; TypeScript failed parsing `csstype` declarations. No project type result was obtained. |
| Lint | Attempted with the incomplete shallow install; ESLint failed parsing a nested `synckit` dependency. No project lint result was obtained. |
| Production build | Attempted with the incomplete shallow install; Vite could not load its Rolldown native binding. No production build result was obtained. |
| Firebase Emulator / live service checks | Not run; no Firebase project credentials or emulator configuration were assumed. |

Do not interpret code-level tests as verification of deployed Google OAuth, Firestore rules, IAM, Vertex AI, or
cross-user isolation in a live project.

## Manual Firebase and Google Cloud configuration

Follow [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md). In summary:

1. Create/select one Firebase/Google Cloud project; enable Google in Firebase Authentication; add the local and
   deployed hostnames to Firebase Auth authorized domains; register the Firebase web app and set its four
   `VITE_FIREBASE_*` build variables.
2. Create a Native Firestore database and apply `firestore.rules` with Firebase CLI. Rules intentionally deny all
   browser reads/writes.
3. Enable Vertex AI API. Attach a dedicated Cloud Run service account with `roles/datastore.user`,
   `roles/aiplatform.user`, and `roles/firebaseauth.viewer` (plus Service Usage Consumer only if project policy
   requires it). Set `FIREBASE_PROJECT_ID`, `GOOGLE_CLOUD_PROJECT`, and `GOOGLE_CLOUD_LOCATION`.
4. Generate a secure answer-signing key of at least 32 characters. Store `ANSWER_SIGNING_KEYS_JSON` in Secret
   Manager, set `ANSWER_SIGNING_ACTIVE_KEY_ID`, and retain old key IDs through their expiry window during rotation.
5. If enabling rate/replay cleanup, configure Firestore TTL on `expires_at` for `systemRateLimits` and
   `answerTokenReplays`. Put guest traffic behind trusted ingress/Cloud Armor because forwarding headers affect
   guest IP throttling.
6. Configure Docker build args for the public Firebase web config. Runtime secret values must not be build args.

## Outstanding risks and release gates

- Restore dependencies with Node >=22.13.0, then run the Vitest suite, `npm run typecheck`, `npm run lint`, and
  `npm run build`; resolve every code failure before calling the migration complete.
- Add/run Firebase Emulator integration tests for Firestore rules and cross-user workspace/assessment access. The
  repository currently has unit tests for UID verification and guest-data de-trusting, but these do not prove live
  Firestore ownership.
- Verify Google sign-in, cancellation, sign-out, revoked tokens, guest conversion/retry, returning-user restoration,
  course/position persistence, hint/assessment retry behavior, token replay and two-account data isolation against
  a non-production Firebase project.
- Confirm Vertex AI model availability, required API enablement, IAM permissions, Cloud Run build arguments,
  runtime Secret Manager injection, and Firestore TTL configuration. None of these were provisioned or deployed.
- Guest progress and unfinished sessions remain device-local until conversion/adoption; guest-import history is
  intentionally not considered mastery evidence. No user data migration from Supabase is included.
- The system can request learner-facing auth/provider errors but cannot verify popup behavior or model quality
  without browser access and live services. Guest IP throttling requires trusted forwarding headers/edge controls.

The migration is not complete and the product is not yet ready for a controlled demo until all release gates have
actual results recorded here.
