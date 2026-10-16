# UNSTUCK: a personalized AI tutor coach

UNSTUCK finds *why* a learner is stuck, teaches the idea another way, checks it with a fresh question, and then
coaches them over time: a "what to do next" card, spaced review, a personal course plan, and a short AI coaching
note built from their real history.

## How it works
- **Diagnose, don't guess.** A quick check question, then up to two follow-ups that separate competing explanations
  of the mistake. The learner can dispute any guess.
- **Teach another way.** Six explanation styles (visual, worked example, hint, simpler, analogy, prerequisite).
  A style is never repeated for the same learner in a session.
- **Verify understanding.** "Demonstrated" means two correct answers in a row, in different contexts, without hints.
- **Coach.** Profile and goals, preferred styles, study time, a personal course, spaced review, and a daily coaching
  note. Everything is saved to the learner's account (Google sign-in).
- **Trustworthy content.** Every model reply is schema-validated, and a quiz answer key is only shown after a second,
  independent solve agrees with it. Failures show a retryable error; there is no canned content.

## Google technology
Google Gemini (Generative Language API) writes questions, diagnoses, explanations, courses and coaching notes.
Google sign-in identifies learners.

## Configuration (project secrets, never committed)
| Name | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio key. Primary AI provider. |
| `GEMINI_MODEL_MAIN` / `GEMINI_MODEL_FAST` | Optional model ids (defaults `gemini-2.5-flash` / `gemini-2.5-flash-lite`). |
| `LOVABLE_API_KEY` | Fallback gateway, used only if no Gemini key is set. |

## Tests
`npx vitest run` covers answer-key verification, output validation, the follow-up limit, course ordering, the rate
limiter and the Gemini request shape.

---

# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
