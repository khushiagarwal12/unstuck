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

```bash
# backend (terminal 1)
cd backend
pip install -r requirements-dev.txt
cp ../.env.example .env            # then edit; use AUTH_MODE=dev and LLM_BACKEND=fake to start without keys
uvicorn app.main:app --reload --port 8000

# frontend (terminal 2)
cd frontend
cp .env.example .env.local
npm install
npm run dev                        # http://localhost:5173
```

## Test

```bash
cd backend && python -m pytest -q     # learning loop, API, LLM layer
cd frontend && npm run build          # typecheck + production build
```

## Status (end of setup session)

Done and tested
- Hypothesis tracking (`posterior.py`), mastery rule (`mastery.py`), strategy policy (`policy.py`) and
  loop transitions (`state_machine.py`), including the "same wrong answer, different reasons" case.
- API skeleton: `/health`, `/api/me`, one error shape, CORS, auth with a clearly separated dev mode.
- LLM layer: rate limiter, timeout, one validation retry, provider errors mapped without leaking detail.
- Home screen: upload and paste with validation, backend wake-up status, clear error states.

Not done yet
- Firebase anonymous sign-in on the frontend and Firestore on the backend (Day 1).
- Documents, retrieval, concepts, questions, sessions (Days 2 to 4).
- `Learn with AI` is shown disabled on purpose (spec section 18).

Known gaps to be aware of
- `GeminiLLM` follows the google-genai SDK and its signatures were checked, but it has not been run
  against the live service because there is no API key yet. Expect to adjust it on first contact.
- The Dockerfile was written but not build-tested (no Docker daemon in the setup session).
- Model ids and rate limits in `.env.example` are placeholders until Day 0 is done.

## Day 0 checklist (you, about an hour)

1. Google AI Studio: create an API key. Copy the free-tier limits (requests per minute and per day)
   for the Flash and Flash-Lite models, and the embedding model name, into `.env`.
2. Firebase console: new project on the free Spark plan. Enable Anonymous sign-in, Firestore and
   Hosting. Create a service-account key for the backend (keep it out of git).
3. Render: create a free web service from `backend/` using the Dockerfile. If it asks for a card,
   stop and tell me. Koyeb is the fallback.
4. Create the public GitHub repo and push this folder.
