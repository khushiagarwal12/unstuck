# UNSTUCK: implementation status and architecture audit

Audit date: 2026-10-16. Branch audited: `main` at `9aef5cf` (same as `origin/main` after `git fetch`).
Scope: read-only audit. Nothing was migrated, rewritten, deployed or pushed, and billing was not touched.
Method: inspected the code, `package.json`, env files, Dockerfile, build output and git history. Cloud consoles
and the live service could not be reached from the audit sandbox, so anything about them is marked **Assumption**.

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

## 7. Status of requested work
- "Discard Lovable from everywhere": started, then stopped at your audit request. No files were changed. Items 5 and 11 above are the plan; the data and auth swap depends on your answer to item 5.
- Nothing pushed. This file is the only change from the audit.
