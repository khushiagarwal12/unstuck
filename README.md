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

**IMPORTANT:** Google sign-in will not work until you configure Firebase. Follow the step-by-step guide in
[docs/FIREBASE_SIGNIN_SETUP.md](docs/FIREBASE_SIGNIN_SETUP.md) to:

1. Enable Google Authentication in Firebase Console
2. Configure authorized domains
3. Register a Web app and get the four `VITE_FIREBASE_*` values
4. Create a Firestore database and deploy security rules
5. Fill in the required environment variables in `.env`

Without Firebase configuration, the app works in guest mode only (local storage, no cross-device sync).

For full Firebase/Google Cloud setup including Vertex AI, see [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md).

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
