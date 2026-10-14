# UNSTUCK

An AI tutor that finds the mistake behind a student's wrong answers, teaches it a different way,
and checks that it worked. Built for a Google hackathon (Media track, personalized learning).

The spec is `ARCHITECTURE.md`. If code and spec disagree, fix one of them in the same commit.

## Layout

```
backend/    FastAPI. app/core is the pure, tested learning loop. app/llm is the only code that talks to Gemini.
frontend/   React + TypeScript + Vite. Design tokens and components live in src/styles.css and src/ui.
```

## Run locally

You need the keys from the Day 0 checklist below. There is no keyless or demo mode: sign-in, the
database and the model are all real.

```bash
# backend (terminal 1)
cd backend
pip install -r requirements-dev.txt
cp ../.env.example .env            # fill in GEMINI_API_KEY, FIREBASE_SERVICE_ACCOUNT_JSON and the model settings
uvicorn app.main:app --reload --port 8000

# frontend (terminal 2)
cd frontend
cp .env.example .env.local         # fill in the four VITE_FIREBASE_* values
npm install
npm run dev                        # http://localhost:5173

# end-to-end check (terminal 3, repo root). Set ENABLE_DIAGNOSTICS=true in backend/.env first
SMOKE_FIREBASE_API_KEY=<web api key> python scripts/smoke.py
```

## Test

```bash
cd backend && python -m pytest -q     # unit tests; test doubles live only in backend/tests
cd frontend && npm run build          # typecheck + production build
```

## Status

Done
- Learning-loop logic (`backend/app/core`): hypothesis tracking, mastery rule, strategy policy and
  transitions, with tests, including the "same wrong answer, different reasons" case.
- API: health, Firebase-token sign-in (no bypass), one error shape, CORS, per-user and global daily
  limits with a judge code, Firestore store, Gemini client, and a diagnostics round trip for Day 1.
- Frontend: Home screen, anonymous Firebase sign-in, backend wake-up status, clear error states.

Not yet verified against live services (needs your keys)
- `GeminiLLM` and `FirestoreStore` follow the documented SDKs and their signatures were checked, but
  they have not run against real Google services. `scripts/smoke.py` is the first real test.
- The Dockerfile has not been build-tested.

Next
- Documents: upload, extraction, chunking, embeddings, concepts. Then the loop, then the session UI.
- `Learn with AI` is shown disabled on purpose until the core loop is stable (spec section 18).

## Day 0 checklist (you, about an hour)

1. Google AI Studio: create an API key. Copy the free-tier limits (requests per minute and per day)
   for the Flash and Flash-Lite models, and the embedding model name, into `.env`.
2. Firebase console: new project on the free Spark plan. Enable Anonymous sign-in, Firestore and
   Hosting. Create a service-account key for the backend (keep it out of git).
3. Render: create a free web service from `backend/` using the Dockerfile. If it asks for a card,
   stop and tell me. Koyeb is the fallback.
4. Create the public GitHub repo and push this folder.
