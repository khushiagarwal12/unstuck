# UNSTUCK

UNSTUCK diagnoses where a learner is stuck, builds a structured course, checks phase objectives, and keeps learner
progress across sessions. Guests can use the diagnostic and practice flow without an account; Google sign-in stores
the authenticated learning workspace in Cloud Firestore.

## Stack

- React, TypeScript and TanStack Start
- Firebase Authentication with Google sign-in
- Cloud Firestore accessed by server functions using Firebase Admin SDK
- Gemini on Vertex AI using Google Application Default Credentials
- Optional Google Text-to-Speech, Translation and YouTube APIs
- Node.js server container for Cloud Run

Firestore is deny-by-default for browser access. Protected server functions verify Firebase ID tokens and select
records only under the verified user's UID. Assessment grades and concept evidence are computed on the server.

## Local development

Use Node.js 22.13 or newer and npm:

```sh
npm ci
copy .env.example .env
npm run dev
```

Set the Firebase web configuration and signing key ring in `.env`. For local server access to Firestore, Firebase
Auth verification and Vertex AI, configure Google ADC (for example, `gcloud auth application-default login`) and
set `FIREBASE_PROJECT_ID` and `GOOGLE_CLOUD_PROJECT`. See [Google and Firebase setup](docs/GOOGLE_SETUP.md).

## Checks

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

## Deployment

The Dockerfile builds the TanStack Start Node server for Cloud Run. Firebase web config is public and is supplied as
Docker build arguments; signing keys are runtime secrets. Do not deploy until Firebase/Google Cloud setup and the
manual checks in `IMPLEMENTATION_STATUS.md` are complete.
