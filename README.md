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

## Status

Done and tested
- **Core Learning Loop**: Bayesian hypothesis tracking (`posterior.py`), transparent mastery derivation (`mastery.py`), adaptive strategy policy (`policy.py`), and pure state machine transitions (`state_machine.py`), verified on the "same wrong answer, different reasons" signature demo pair.
- **Document Ingestion & Retrieval**: PyMuPDF page/text extraction, overlapping chunking, Gemini embeddings, LRU in-memory cosine vector store, and fuzzy citation validator.
- **Question Generation & 4-Gate Validation**: Gemini-grounded question generator with schema checks, blind-solve verification, duplicate suppression, and citation grounding.
- **Curated Benchmark**: Hand-verified fractions curriculum (`backend/app/sample/fractions_data.py`) with 5 concepts, misconception catalogs, probe/follow-up/practice questions, and visual specifications.
- **API Endpoints**: Documents (upload/paste/sample), Sessions (start, step, answer, challenge, summary), Progress (mastery breakdown & recurring errors), Usage (quota tracking), Courses (topic intake & diagnostic placement).
- **Storage Layer**: Dual-mode Firestore (`FirestoreDatabase` + `MemoryDatabase` fallback), file storage, and audit event sinks.
- **Frontend App**: Production React 19 + TypeScript + Vite client with full screen routing (`Home`, `StudySpace`, `LearningSession`, `Summary`, `Progress`, `Course`), responsive design tokens, SVG mathematical visualizations (`FractionBar`, `NumberLine`, `AreaModel`), and transparent hypothesis evidence cards.
- **Verification**:
  - `pytest`: 51 unit & integration tests passing.
  - `evals/run_evals.py`: 5/5 fractions evaluation test cases passing.
  - `scripts/smoke.py`: End-to-end API smoke test passed against running server.
  - `npm run build`: TypeScript typecheck & Vite production build passing with 0 errors.

## Day 0 checklist (you, about an hour)

1. Google AI Studio: create an API key. Copy the free-tier limits (requests per minute and per day)
   for the Flash and Flash-Lite models, and the embedding model name, into `.env`.
2. Firebase console: new project on the free Spark plan. Enable Anonymous sign-in, Firestore and
   Hosting. Create a service-account key for the backend (keep it out of git).
3. Render: create a free web service from `backend/` using the Dockerfile. If it asks for a card,
   stop and tell me. Koyeb is the fallback.
4. Create the public GitHub repo and push this folder.
