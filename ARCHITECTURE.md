# UNSTUCK — Technical Architecture & Implementation Spec

Status: v0.1 (draft for review) · Written 2026-10-14 · Target: 4–5 full build days, no billing account.

This file is the **source of truth** for humans and AI coding sessions. If code and this file disagree, fix one of them in the same commit.

---

## 0. Rules for every coding session (human or AI)

1. **Contract first.** Do not change an API shape, Pydantic schema or Firestore field without updating sections 6–7 in the same commit.
2. **The backend owns the learning loop.** Gemini generates and interprets content. It never decides the next state and never writes mastery.
3. **Never send the answer key or misconception mapping to the client** before the student has answered.
4. **No secrets in the repo or frontend.** API keys and the Firebase service account live only in host environment variables.
5. **Every model output is validated** (schema, then domain checks) before use. One retry, then a safe fallback. No fake or hardcoded AI responses in the real flow. The sample path is clearly labelled as pre-generated.
6. **Every LLM call goes through `LLMClient`** (quota guard, cache, retries, logging). No direct SDK calls elsewhere.
7. **Do not log raw document text or student free text.** Log ids, sizes, latencies and error codes.
8. **State machine, posterior, policy and mastery code is pure Python with unit tests.** No I/O in those modules.
9. Small increments: after each one, run tests and the smoke script (`scripts/smoke.py`) against the deployed backend.

---

## 1. Constraints and decisions (as of 2026-10-14)

### 1.1 Hard constraints from the team
- **No billing account / card is possible (confirmed, final).** Everything must run on free plans. This also rules out the GCP Always Free tier and the $300 Free Trial, because Google requires a billing account (payment method) for both. Organizers may grant credits after this round, so the design must be **credits-ready** (section 11).
- 4–5 full days. Public live URL, demo video, public repo, live pitch.
- Judging mentions Google usage explicitly. The Gemini API (AI Studio) was confirmed acceptable.
- "Any document" must work in the open-upload moment, including scanned PDFs and photos of notes, **best-effort with a clear fallback message**.
- Regional language and voice are **not required**. They are cut, except possibly a browser "listen" button at the very end.
- Students start learning one topic early while the rest of the document processes in the background.

### 1.2 Facts checked by search on 2026-10-14 (re-verify on Day 0)

| Item | Finding | Impact |
|---|---|---|
| Firebase Spark plan | Needs no payment method. Auth (standard), Firestore (1 GiB storage; 50k reads, 20k writes, 20k deletes per day, per Google's free-features page) and Hosting (10 GB storage/transfer) are available | Our persistence + frontend host |
| Cloud Storage for Firebase | Requires Blaze (billing) since Feb 3, 2026 | **No file storage.** Process uploads in memory, keep only derived text, delete originals |
| Cloud Functions / Cloud Run / Vertex AI | Need billing | Not usable now |
| **Hugging Face Docker Spaces** | **Creating Docker/Gradio Spaces now requires a paid plan (PRO, about $9/mo, needs a card)**; free accounts get static Spaces and 2 ZeroGPU Spaces only (docs and forum threads, July 2026) | **HF is out for this team.** Reverses the earlier plan |
| Render free web service | No card reported by several sources (one forum thread reports a card prompt, so **verify at signup**). 512 MB RAM, ~0.1 CPU, spins down after 15 min idle, ~1 min wake, 750 instance-hours/month, **ephemeral filesystem** | **Chosen backend host** (see 1.3) |
| Gemini API free tier | Free, rate-limited, varies by model. **Free-tier inputs/outputs may be used to improve Google products and reviewed by humans.** Paid tier does not do this. Pro models have effectively left the free tier since April 2026. Model ids seen on the official pricing page include `gemini-3-flash-preview` and `gemini-3.1-flash-lite-preview`. Preview models have stricter limits | Use Flash / Flash-Lite class only. Show a privacy notice. Read the live rate-limit numbers in AI Studio and put them in `.env` |
| Gemini embeddings model | Name and limits **not verified** | Configurable via `GEMINI_EMBED_MODEL` |

### 1.3 Backend host decision
- **Primary: Render free Web Service (Docker).** Fallback if it demands a card: Koyeb free instance (reports conflict, verify) or any container host that needs no card.
- **Dockerfile reads `$PORT`, holds no local state and can restart at any time.** All state is in Firestore, which makes the move to Cloud Run (when credits arrive) a redeploy.
- Consequences of the host's limits, designed in:
  - **Cold start ~1 min:** the frontend calls `GET /health` on page load, and we keep the service warm before the pitch with a ping loop.
  - **0.1 CPU / 512 MB:** cap documents at 40 pages / 15 MB / 150 chunks. Heavy work is API calls, which is cheap on CPU. Use PyMuPDF for extraction (fast, native).
  - **Ephemeral disk:** nothing is written to disk that we can't lose.
  - **Restarts mid-job:** background jobs are resumable (section 5.4).

---

## 2. System overview

```
 Browser (React + TS)  ──Firebase Hosting (free)
   │  Firebase anonymous Auth → ID token
   ▼
 FastAPI backend (Docker, Render free)  ──► Gemini API (AI Studio): generate, embed, vision
   │   • learning-loop state machine
   │   • ingestion pipeline (background tasks)
   │   • quota guard + cache
   ▼
 Firestore (Spark): users, documents, chunks, concepts, questions, sessions, mastery
```

Clients never touch Firestore directly (rules deny all). They only use Firebase for **Auth + Hosting**. The backend uses the Firebase Admin SDK with a service-account key held in the host's secret env var (key generation does not require billing).

### 2.1 Google products → what the student/judge sees

| Google product | Role | Visible in the product |
|---|---|---|
| Gemini API (Flash / Flash-Lite) with structured output | Concept extraction, misconception catalog, question generation, answer interpretation, adaptive explanations | Every screen |
| Gemini multimodal input | OCR-style extraction of scanned PDFs and photos of notes | "Upload a photo of your notes" |
| Gemini embeddings | Retrieval over the student's own material | Source citations with page numbers |
| Firebase Authentication (anonymous) | Per-user isolation, no sign-up friction | Invisible; progress persists across refresh |
| Firestore | Session state, attempts, mastery, progress | Refresh-safe sessions, My Progress |
| Firebase Hosting | Frontend delivery | The public URL |
| *Credits-ready (disabled adapters):* Vertex AI, Cloud Run, Cloud Storage, Cloud TTS, BigQuery, Secret Manager, Cloud Logging | See section 11 | Shown on the "Roadmap" slide |

Optional and decided later: Google ADK for tool wiring (only if the core loop is done by Day 4), and the BigQuery sandbox for a strategy-effectiveness chart (stretch).

---

## 3. The learning loop

### 3.1 Principle
The model is a **function**: `generate_*` and `interpret_*`. The state machine, hypothesis tracking, strategy choice and mastery are **deterministic and testable**.

### 3.2 States (per session × concept)

```
START → PROBE ─answer─► EVALUATE
EVALUATE:
   correct            → TRANSFER-CHECK (one different-context question)  → SUMMARY or next
   wrong, hypothesis clear      → EXPLAIN(strategy)
   wrong, hypothesis ambiguous  → FOLLOW_UP (discriminating Q or "why?" text), max 2 → EXPLAIN (tentative)
EXPLAIN → PRACTICE (fresh question, new context_tag) → REASSESS
REASSESS:
   correct, mastery rule met  → SUMMARY
   correct, rule not yet met  → PRACTICE (one more, different context)
   wrong                      → EXPLAIN with a strategy not yet tried (max 3 cycles)
                              → after 3: PREREQ_REVIEW once, then SUMMARY with "needs help" flag
Student may CHALLENGE a hypothesis at any time → posterior penalty + FOLLOW_UP.
```

### 3.3 Hypothesis tracking (not LLM confidence)
Hypotheses H = {M1..Mk (from the concept's catalog), NONE (slip or no misconception)}. Start uniform over M's with NONE at 0.2, then normalize.

Update on a multiple-choice answer:
- **Correct option:** `like(Mi) = 0.2`, `like(NONE) = 0.9`.
- **Wrong option `o`:** `like(Mi) = o.signals.get(Mi, 0.05)`, `like(NONE) = 0.1`.
- Posterior ∝ prior × like, then normalize.

Update on free-text justification: Gemini returns for each Mi one of `supports | contradicts | unclear`, mapped to multipliers 3.0 / 0.25 / 1.0.

Challenge: multiply the challenged hypothesis by 0.2, then normalize.

**Decision rule:** accept hypothesis `H*` when `p(H*) ≥ 0.60` and `p(H*) − p(second) ≥ 0.25`. Otherwise follow up (max 2), then proceed as **tentative** ("Likely: …", never "You think …").

The UI shows the label, the evidence ("You chose 3/8, a common pattern when the larger denominator is taken as the larger fraction"), and a "That's not why I chose it" button. The displayed percentage is the **posterior**, and the UI wording is "likely" / "possible".

### 3.4 Strategy policy
Strategies: `hint`, `simplified`, `worked_example`, `analogy_visual`, `prerequisite_review`.

1. Each catalog misconception carries `preferred_strategies` (ordered). Curated for the fractions sample, Gemini-proposed (then validated against the allowed list) for other documents.
2. Choose the first preferred strategy not in `session.tried_strategies`.
3. If the first strategy failed (wrong on the next practice), never repeat it.
4. After two failures use `prerequisite_review` (use the concept's prerequisites).
5. If the hypothesis is tentative, prefer `hint` or `simplified` first (cheap, low commitment).

### 3.5 Mastery rule (transparent, evidence-based)
Concept status is **derived** from stored attempts, never set by the LLM:
- `not_assessed`: no scored attempts.
- `developing`: at least one scored attempt.
- `demonstrated`: the last **2 scored attempts are correct**, on **different questions with different `context_tag`**, **without hint**, and at least one came **after** remediation (or two clean transfer successes with no remediation needed).
- Any later wrong scored attempt demotes `demonstrated` → `developing`.
A single correct answer never produces `demonstrated`.

### 3.6 The signature demo: same wrong answer, different reasons
Allow one option to carry signals for **two** misconceptions (e.g. `{"M1": 0.5, "M3": 0.4}`). The posterior then stays ambiguous, so the engine asks a **discriminating follow-up** whose options separate M1 from M3. Two students pick the same wrong option, answer the follow-up differently, and get different strategies. Authoring this pair for the fractions sample is a named Day 3 task.

---

## 4. Question quality (the biggest risk)

Every generated question goes through `validate_question()` before it can reach a student:

1. **Schema:** 3–4 options, exactly one correct, every distractor has ≥1 `signals` entry referencing a real misconception id of that concept, a rationale, a `context_tag`.
2. **Blind solve:** a separate Flash-Lite call receives only stem + options (no key) and must choose the correct option. Disagreement → regenerate once, then discard.
3. **Duplicate check:** cosine similarity of stem embedding vs. previous questions in this session `< 0.90`.
4. **Grounding:** `source_chunk_ids` exist and belong to this document.
5. Mark `verified = true` only if all pass. Unverified questions are never served in the live loop. The sample path uses the **hand-checked** bank.

Generation is **lazy and per concept** to protect the free-tier quota (section 8).

---

## 5. Ingestion and retrieval

### 5.1 Pipeline (per document, runs as a background task)

| Stage (`status`) | Work | Calls |
|---|---|---|
| `queued` → `extracting` | Validate type/size/pages. PyMuPDF text per page. Pages with fewer than 50 chars are flagged `needs_vision`. Pasted text = one pseudo-page | 0 |
| `vision` (only if needed) | **Best-effort:** send up to 10 flagged pages (or one photo) to Gemini multimodal to transcribe into text. Over the cap → partial result plus a clear message | ≤ 3 |
| `chunking` | ~800-char chunks, 100 overlap, keep `page` and `chunk_id` | 0 |
| `embedding` | Batch-embed chunks (versioned: model name + dim stored) | 1–3 |
| `concepts_ready` | One structured call → concepts (name, description, prerequisites, source refs). **The student can pick a topic here.** | 1 |
| `ready` | Background: concept catalogs and question banks, lowest priority, interruptible by the quota guard | lazy |

### 5.2 Early start
As soon as `concepts_ready`, the UI lets the student choose a concept. Creating a session triggers **just-in-time** generation of that concept's misconception catalog and first probe question (priority 1). Other concepts wait in the background queue (priority 3) or generate on demand.

### 5.3 Retrieval
- Store text and vectors compactly: one `chunks` doc (texts) and one `vectors` doc (float16 as Firestore `Bytes`, base64-free) per document. At 150 chunks × 768 dims × 2 bytes ≈ 230 KB, which fits under the 1 MiB doc limit. Verify the actual embedding dimension.
- Backend loads both docs (2 reads) into an in-memory LRU per document, does numpy cosine top-k (k=4). **This avoids burning Firestore read quota.** After a restart, reload (2 reads).
- Restrict retrieval to the owner's document and to the selected concept's source refs plus top-k by question.

### 5.4 Resumable jobs
`documents/{id}.updatedAt` and `status` are written at each stage. If `GET /documents/{id}` sees an in-progress status with `updatedAt` older than 3 minutes, it restarts from the last completed stage (jobs are idempotent per stage, keyed by `contentHash`).

### 5.5 Grounding and citations
- Gemini returns `source_refs: [{chunk_id, quote}]`.
- Backend verifies `normalize(quote)` appears in that chunk's text (case/whitespace-insensitive, light fuzzy tolerance). Invalid refs are dropped.
- If none remain: show the explanation labelled **"General explanation, not found in your material"**. Never invent a page number.

### 5.6 Prompt injection and untrusted text
- Document text goes only inside clearly delimited data blocks in the prompt, with a system rule that the block is untrusted data and never instructions.
- All outputs are schema-constrained. The model has no tools with side effects, so injected text cannot trigger actions.
- Strip control characters. Cap per-call context.
- Render model text as plain text/markdown with HTML disabled. Sanitize any SVG (section 9.4).

---

## 6. Data model (Firestore)

All reads and writes go through the backend (Admin SDK). Security rules: `allow read, write: if false;`.

| Path | Key fields |
|---|---|
| `users/{uid}` | `createdAt`, `usage: {date, llmCalls, uploads}` |
| `documents/{docId}` | `userId`, `fileName`, `contentHash`, `status`, `statusDetail`, `progress`, `pageCount`, `isSample`, `visionPagesUsed`, `embedModel`, `embedDim`, `createdAt`, `updatedAt`, `error?` |
| `documents/{docId}/blobs/chunks` | `chunks: [{id, page, text}]` |
| `documents/{docId}/blobs/vectors` | `vectors: Bytes` (float16, row-major), `ids: [chunkId]` |
| `documents/{docId}/concepts/{conceptId}` | `name`, `description`, `prerequisites: [conceptId]`, `sourceRefs`, `catalogStatus`, `misconceptions: [{id, label, description, preferred_strategies}]` |
| `documents/{docId}/questions/{qid}` | full `Question` including key and signals (server-only), `verified`, `createdFor: conceptId` |
| `sessions/{sid}` | `userId`, `documentId`, `conceptId`, `state`, `posterior`, `triedStrategies`, `cycleCount`, `followUpCount`, `currentStepId`, `startedAt`, `completedAt?`, `before`, `after` |
| `sessions/{sid}/attempts/{aid}` | `questionId`, `conceptId`, `kind`, `chosenOptionId`, `isCorrect`, `hintUsed`, `freeText?` (stored, never logged), `strategyBefore`, `ts` |
| `mastery/{uid}_{conceptKey}` | `status`, `evidenceCount`, `lastAssessedAt`, `recentAttempts: [{correct, contextTag, hint}]` (last 5) |

**Quota math (free plan, verify numbers):** one session ≈ 10 attempts × (1 write attempt + 1 write session) + ~20 reads ≈ 40 ops. A 30-judge demo day ≈ 1,500 ops, far below daily limits. Ingestion writes ≈ 10 per document. The danger is accidental per-chunk reads, which the in-memory LRU prevents.

---

## 7. API contract

Auth: every `/api/*` request carries `Authorization: Bearer <Firebase ID token>`. The backend verifies it and uses `uid`. Errors are `{ "error": { "code", "message", "retryable": bool } }`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Warm-up, no auth. Returns `{ok, version}` |
| POST | `/api/documents` | multipart `file` (PDF/PNG/JPG) **or** JSON `{title, text}` → `202 {documentId, status}` |
| POST | `/api/documents/sample` | Clone the pre-processed sample for this user → `{documentId}` |
| GET | `/api/documents/{id}` | `{status, progress, statusDetail, pageCount, concepts?[], warnings[]}` (poll every 2 s) |
| DELETE | `/api/documents/{id}` | Delete document and derived data |
| POST | `/api/sessions` | `{documentId, conceptId}` → `{sessionId, step}` |
| GET | `/api/sessions/{id}` | Current step (refresh-safe) |
| POST | `/api/sessions/{id}/answer` | `{stepId, optionId?, freeText?, hintUsed?}` → `{step}` |
| POST | `/api/sessions/{id}/challenge` | `{stepId, freeText?}` → `{step}` |
| GET | `/api/sessions/{id}/summary` | Before/after, hypotheses, strategies, citations |
| GET | `/api/progress` | Concepts with status, recurring errors, sessions |
| GET | `/api/usage` | Remaining daily quota for this user |

### 7.1 Core schemas (Pydantic; mirrored as TS types)

```python
from typing import Literal, Optional
from pydantic import BaseModel, Field

Strategy = Literal["hint", "simplified", "worked_example", "analogy_visual", "prerequisite_review"]
MasteryStatus = Literal["not_assessed", "developing", "demonstrated"]

class SourceRef(BaseModel):
    chunk_id: str
    page: int
    quote: str = Field(max_length=300)

class VisualSpec(BaseModel):          # rendered by frontend components, not drawn by the LLM
    type: Literal["fraction_bar", "number_line", "area_model", "none"]
    params: dict = {}

class Option(BaseModel):
    id: str                            # "a".."d"
    text: str
    signals: dict[str, float] = {}     # misconception_id -> P(choose | misconception); server-only

class Question(BaseModel):             # server-only; client gets QuestionPublic
    id: str
    concept_id: str
    kind: Literal["probe", "follow_up", "practice", "transfer"]
    stem: str
    options: list[Option] = Field(min_length=3, max_length=4)
    correct_option_id: str
    rationale: str
    context_tag: str
    visual: Optional[VisualSpec] = None
    source_chunk_ids: list[str] = []
    verified: bool = False

class QuestionPublic(BaseModel):
    id: str
    stem: str
    options: list[dict]                # [{id, text}]
    visual: Optional[VisualSpec] = None

class Hypothesis(BaseModel):
    misconception_id: str
    label: str
    probability: float                 # posterior, not LLM self-report
    evidence: str                      # why we think this, shown to the student
    status: Literal["tentative", "supported"]

class Explanation(BaseModel):
    strategy: Strategy
    title: str
    body_markdown: str
    visual: Optional[VisualSpec] = None
    source_refs: list[SourceRef] = []
    grounded: bool                     # False => "not found in your material" label

class Step(BaseModel):
    id: str
    kind: Literal["question", "follow_up", "explanation", "summary", "error"]
    question: Optional[QuestionPublic] = None
    explanation: Optional[Explanation] = None
    hypothesis: Optional[Hypothesis] = None
    concept_status_before: MasteryStatus
    concept_status_after: Optional[MasteryStatus] = None
    note: Optional[str] = None         # e.g. "Investigating: how you compare denominators"
```

LLM output schemas (`ConceptList`, `MisconceptionCatalog`, `GeneratedQuestion`, `JustificationReading`, `GeneratedExplanation`) live in `backend/app/llm/schemas.py`, one per prompt file in `llm/prompts/`.

---

## 8. LLM client, quota and caching

`LLMClient` is the only code that touches the Gemini SDK.

- **Modes via env:** `LLM_BACKEND=aistudio|vertex` (vertex is wired but disabled).
- **Tiers via env:** `GEMINI_MODEL_MAIN` (concept extraction, catalogs, explanations), `GEMINI_MODEL_FAST` (blind solve, justification reading, cheap checks), `GEMINI_EMBED_MODEL`. Defaults are placeholders that you confirm on Day 0 from the AI Studio rate-limit page. Prefer **stable** over *preview* models if available.
- **Structured output:** pass the Pydantic schema, parse, validate. On failure: one retry that includes the validation error, then a typed fallback.
- **Timeouts and retries:** 25 s timeout, 1 bounded retry with jitter on 429/5xx, then a user-facing "busy, try again" step with `retryable: true`.
- **Quota guard:** an in-process token bucket per model (RPM from env) plus Firestore daily counters per user and global. Priorities: `interactive (1) > jit (2) > background (3)`. When global budget is below the reserve, background work stops and new uploads are refused, but **the sample and existing sessions keep working**.
- **Cache:** key = hash(prompt template version + inputs). Cached in Firestore for concept extraction, catalogs and embeddings (by `contentHash`), so re-uploading the same document costs nothing.
- **Do not rotate multiple keys to dodge limits.** That violates terms.

---

## 9. Frontend

React + TypeScript + Vite, Firebase Hosting, Firebase JS SDK for anonymous Auth only.

### 9.1 Screens
1. **Home:** Upload / paste / "Try the sample". Recent sessions. Privacy notice ("Don't upload private material. On the free tier, content may be used by Google to improve its products.").
2. **Study space:** Processing progress (stage list), then concept cards with status chips. Pick a concept as soon as `concepts_ready`.
3. **Learning session:** one question at a time, visible "what UNSTUCK is investigating" strip, hypothesis card with evidence and "That's not why" button, explanation with citations, hint button.
4. **Insights / My progress:** concept map (cards with prerequisites), before/after, recurring errors, concepts to revisit.

### 9.2 UX rules
- Visually distinct **hypothesis** (dashed outline, "likely") vs **demonstrated** (solid, check).
- Loading skeletons, retry buttons, empty states, friendly errors. Never a dead spinner: show stage text.
- Call `/health` on load. If the backend is waking, show "Waking the tutor (up to a minute)".
- Poll `GET /documents/{id}` every 2 s with backoff. Sessions are refresh-safe via `GET /sessions/{id}`.

### 9.3 Visuals
Fraction bars, number lines and area models are **deterministic React/SVG components** driven by `VisualSpec.params`. The LLM only chooses the type and numbers. This avoids unreliable model-drawn diagrams and needs no image-generation product.

### 9.4 Optional last-day items
Browser "Listen" button (Web Speech API, free), streaming explanations.

---

## 10. Abuse and quota protection (public URL, free tier)

1. **Sample path guaranteed:** the original sample notes are pre-processed and cached, so the core demo never depends on the quota.
2. **Per-user daily caps** (anonymous uid): e.g. 3 uploads, 120 LLM calls. Enforced server-side.
3. **Global daily budget counter** with a reserve. When low → "sample-only mode" banner.
4. **Judge access code:** an env-configured code that raises the caps during the judging window.
5. **Upload limits:** 15 MB, 40 pages, MIME + magic-byte check, vision pages ≤ 10.
6. **Basic rate limiting** per uid/IP at the API.
7. Document deletion endpoint and automatic deletion of originals (we never persist the file).

---

## 11. Credits-ready migration (when organizers grant credits)

| Today (free) | Switch to | Change required |
|---|---|---|
| Gemini API (AI Studio) | Vertex AI Gemini | `LLM_BACKEND=vertex`, project/region env |
| Render container | Cloud Run | Deploy the same Docker image, set env |
| Env-var secrets | Secret Manager | Mount secrets |
| stdout JSON logs | Cloud Logging | Automatic on Cloud Run |
| No file storage | Cloud Storage adapter (keep PDFs, generated media) | Implement `FileStore` interface |
| No analytics | Event emitter → BigQuery | `events` sink adapter |
| None | Cloud TTS / Translation / STT, Imagen/Veo | Feature-flagged adapters, off by default |
| Anonymous auth | Google sign-in + App Check | Config + small UI change |

Keep interfaces `FileStore`, `EventSink`, `LLMClient`, `VectorStore` from Day 1, with free-tier implementations.

---

## 12. Repository layout

```
unstuck/
  ARCHITECTURE.md   README.md   .env.example   .gitignore
  backend/
    Dockerfile  requirements.txt
    app/
      main.py  config.py
      auth.py                     # Firebase ID token verification
      api/ documents.py sessions.py progress.py usage.py
      core/ state_machine.py posterior.py policy.py mastery.py   # pure, unit-tested
      llm/  client.py quota.py cache.py schemas.py prompts/*.md
      ingestion/ extract.py vision.py chunk.py embed.py pipeline.py
      retrieval/ store.py search.py citations.py
      questions/ generate.py validate.py
      storage/ firestore.py file_store.py events.py
    tests/
    sample/                       # original sample notes (committed) ; NCERT PDFs are gitignored
  frontend/
    src/ api/ components/ screens/ visuals/ state/
  evals/
    fractions_cases.json  run_evals.py
  scripts/ smoke.py  warm.sh
```

---

## 13. Sample content strategy
- **Committed sample:** short, **original** fractions study notes (about 8–10 pages) written for the demo, with the misconception catalog and question bank hand-verified. This is safe to publish and fully deterministic.
- **NCERT Class 6–7 fractions chapter:** use as an *uploaded* real-textbook test and for the open-upload moment. Do not commit it to the public repo. Check NCERT's reuse terms before showing derived text publicly.

Fractions catalog seed (curate and verify before use):
- M1: larger denominator means larger fraction.
- M2: compare numerators only, ignore denominators.
- M3: additive reasoning (equal differences mean equal fractions, e.g. 2/3 vs 3/4).
- M4: whole-number bias in operations (add numerators and denominators).
Prerequisites: equal parts of a whole, unit fractions, equivalent fractions, common denominators.

---

## 14. Evaluation plan
- 20–30 cases for fractions (plus 3–5 for one non-math document to measure how far "any document" really holds). Each case: concept, source chunk, intended misconception, sample answer sequence, expected follow-up, expected strategy, a fresh question.
- Metrics: **question validity rate** (blind-solve agreement + manual spot-check), **diagnosis top-1 agreement**, **citation validity rate**, **strategy appropriateness** (manual rubric), **remediation response** (wrong → correct on fresh question in simulated student runs).
- `evals/run_evals.py` runs the pipeline with a *simulated student* (scripted answers) and prints a table. Run after every prompt or policy change and save the output for the pitch.
- Be honest in the pitch: this is a prototype signal, not proof of learning gains.

---

## 15. Day-by-day plan (5 days)

**Day 0, tonight (1–2 h): setup and verification**
- [ ] Google AI Studio API key. Open the **rate-limit page** and record RPM / TPM / RPD for the Flash and Flash-Lite models. Confirm the embedding model name.
- [ ] Firebase project on **Spark**. Enable Anonymous Auth, Firestore, Hosting. Create a service-account key (for Admin SDK).
- [ ] Render account: confirm the **free web service creates without a card**. If it asks for a card, try Koyeb.
- [ ] GitHub repo (public), this file committed. Download the NCERT chapter locally (gitignored).
- [ ] Fill the verify-table in section 1.2 with real numbers.

**Day 1: skeleton and contracts**
Backend skeleton, auth, config, `LLMClient` with quota and cache, Firestore layer, `/health`, Dockerfile, deploy to Render. Frontend skeleton with anonymous Auth, deploy to Firebase Hosting. Pydantic ↔ TS types. *Exit:* deployed round trip: login → authenticated call → Gemini structured call → Firestore write.

**Day 2: documents**
Upload/paste, extraction, chunking, embedding, vector store, concept extraction, status polling UI, sample document pre-processing, citation validator. Scanned/vision path behind a flag (best-effort). *Exit:* a PDF becomes concept cards with page-cited chunks.

**Day 3: the loop**
Misconception catalog generation, question generation + `validate_question`, posterior, policy, explanations with grounding, state machine with unit tests, the **two-student demo pair**, eval harness v0. *Exit:* a CLI/simulated student completes the loop end to end.

**Day 4: product**
Frontend learning session, hypothesis card, challenge button, visual components, mastery + persistence + refresh-safety, summary and progress screens, knowledge map. *Exit:* a human completes the loop in the deployed app.

**Day 5: reliability and finale prep**
Quota/abuse limits, error and empty states, privacy notice, eval run and fixes, scanned-doc path hardening, README and Google-usage page, fallback demo mode, backup video, warm-up script, pitch rehearsal on the deployed URL.

**If time shrinks to 4 days, cut in this order:** scanned/photo path, knowledge-map polish, progress page, listen button. **Never cut:** the loop, citation validation, question verification, error handling, deployment, fallback video.

---

## 16. Demo and fallback
- Script: problem → wrong answer on the sample → hypothesis with evidence → different explanation with fraction-bar visual and page citation → fresh question → before/after → "now try your own notes".
- **Fallback 1:** sample mode with cached generations (labelled pre-generated). **Fallback 2:** recorded video. **Pre-pitch:** run `scripts/warm.sh`, start a session, and keep one tab open.

---

## 17. Open risks
1. Free-tier rate limits (numbers still unknown). Mitigated by caching, lazy generation, tiering, caps.
2. Render cold start and 0.1 CPU. Mitigated by warm-up, caps, API-bound workload.
3. Question quality on arbitrary documents. Mitigated by blind-solve verification and honest scoping.
4. Free-tier data-use terms. Mitigated by notice and no persistence of originals.
5. Host or free-plan terms changing again (HF just did). Mitigated by portable container and storage/LLM interfaces.

---

## 18. Learn with AI (topic-first course mode) — "Ship if stable"

**Decision (2026-10-14):** a thin layer over the existing loop, built only after the Day 4 exit criterion (a human completes a full session in the deployed app). It is the first thing cut after the scanned/photo path if time shrinks. The fractions notes-based demo remains the main story.

### 18.1 Flow
```
TOPIC_INTAKE → SCOPE → PLACEMENT → PLAN → MODULE (existing session loop per concept) → REPLAN → … → COURSE_SUMMARY
```
1. **TOPIC_INTAKE:** `{topic, level?, goal?}`. Reject topics that are unsafe or too broad ("everything about physics") and ask the student to narrow.
2. **SCOPE:** one `GENERATE_MAIN` call returns 5–8 concepts with prerequisites (reuse `ConceptList`). Backend validates: prerequisites form a DAG, names unique, count in range. Misconception catalogs are generated lazily, per concept, as in section 5.2.
3. **PLACEMENT:** at most 6 questions, one per concept, ordered by prerequisite depth. Generated in **one batched call**, verified with **one batched blind-solve call**. If a concept's prerequisite is answered wrong, skip its dependents and treat them as `not_assessed` (to be learned). Placement attempts are scored attempts and feed the same posterior and mastery rules.
4. **PLAN (deterministic, no LLM):** topological order over concepts whose status is not `demonstrated`; cap 6 modules. Module type: `confirm` (placement correct once, so status is `developing`: one transfer question) or `learn` (placement wrong or skipped: full loop from EXPLAIN with the placement-diagnosed hypothesis).
5. **MODULE:** creates a normal `session` for that concept. No changes to the state machine.
6. **REPLAN:** after each module, recompute the plan from mastery state. The student sees the path update.

### 18.2 Grounding without a document
- Create a **topic document** (`documents/{id}` with `isTopic: true`, no chunks or vectors). Explanations get `grounded = false` and the UI label "General explanation, not from your notes".
- Optional later step: the student attaches notes to the course. The pipeline then adds chunks to the topic document, and later modules get citations.
- Do not assume Google Search grounding is available on the free tier (listings suggest it is not for current models). Verify on Day 0. If available, it is a bonus source and counts against quota.

### 18.3 Data model and API additions
`courses/{courseId}`: `userId`, `documentId` (the topic document), `topic`, `level?`, `goal?`, `status`, `placement: {questionIds, answered}`, `plan: [{conceptId, order, type: "confirm"|"learn", status}]`, `createdAt`, `updatedAt`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/courses` | `{topic, level?, goal?}` → `{courseId, step}` (scope and placement start) |
| GET | `/api/courses/{id}` | Course with ordered plan and statuses (refresh-safe) |
| POST | `/api/courses/{id}/placement/answer` | `{stepId, optionId}` → next placement step or the plan |
| POST | `/api/courses/{id}/modules/{conceptId}/start` | Creates the session for that module → `{sessionId, step}` |

### 18.4 Quota and quality
- Course creation counts as one "upload" against the per-user daily cap, and as ≈ 4 LLM calls (scope, batched placement generation, batched verification, one buffer). Modules generate lazily.
- Same question validation as section 4 (schema, blind solve, duplicate check). The "grounding" check is skipped for topic documents.
- Content accuracy risk is higher than with notes. Keep hand-checked fractions content for the demo, and label everything else clearly.

### 18.5 Frontend and evaluation
- Home shows two entry cards: **Study my notes** and **Learn with AI**. A Course screen shows the ordered path with per-module status chips and a "next up" action.
- Add 5 topic cases to the eval set (fractions, photosynthesis, Newton's laws, plus two more) checking concept-graph validity, placement ordering, plan correctness and a simulated student finishing one module.
