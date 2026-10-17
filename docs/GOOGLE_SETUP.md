# Firebase, Firestore and Google Cloud setup

The application is configured for Firebase Authentication and Cloud Firestore. Existing Supabase learner data is
not migrated. No Firebase project, OAuth provider, database, IAM binding, secret, or Cloud Run service is created by
the application code.

## 1. Create and configure the Firebase project

1. In Firebase Console, create/select a project and link it to the intended Google Cloud project. Use the same
   project for Firebase Auth, Firestore, and Vertex AI.
2. In **Authentication → Sign-in method**, enable **Google** and select the support email.
3. In **Authentication → Settings → Authorized domains**, add the local development hostname and production
   application hostname. Firebase's OAuth redirect handler uses the configured `authDomain`.
4. In **Project settings → General → Your apps**, register a Web app and copy its API key, Auth domain, Project ID
   and App ID to the `VITE_FIREBASE_*` values in `.env`. These client values are public configuration, not secrets.
5. In **Firestore Database**, create a Native mode database in the region selected for the application. Apply
   `firestore.rules` from the Firebase CLI:

   ```sh
   firebase deploy --only firestore:rules --project YOUR_FIREBASE_PROJECT_ID
   ```

   `firebase.json` in this repository points the CLI at `firestore.rules`. The rules deny all direct client reads
   and writes; learner data is accessed through authenticated server functions.

## 2. Configure Google Cloud APIs and runtime identity

Enable **Vertex AI API**. Create/use a dedicated Cloud Run service account and grant only the roles needed by the
enabled features:

- **Cloud Datastore User** (`roles/datastore.user`) for Firestore read/write through Firebase Admin.
- **Vertex AI User** (`roles/aiplatform.user`) for Gemini requests on Vertex AI.
- **Firebase Authentication Viewer** (`roles/firebaseauth.viewer`) for revoked-token checks with
  `verifyIdToken(token, true)`.
- **Service Usage Consumer** (`roles/serviceusage.serviceUsageConsumer`) only if required by the project's API
  invocation policy.

In Cloud Run, attach that service account as the runtime identity. The Firebase Admin SDK and Google auth library
use Application Default Credentials (ADC); do not put a service-account JSON key in the app or source repository.
For local development, install the Google Cloud CLI, select the project, and run:

```sh
gcloud auth application-default login
gcloud config set project YOUR_GOOGLE_CLOUD_PROJECT
```

For Text-to-Speech and Cloud Translation, either enable those APIs and use ADC or use a restricted Google API key.
YouTube Data API currently uses a separate restricted API key. Configure optional APIs only when needed.

## 3. Configure environment

Copy `.env.example` to `.env` and set:

| Variable | Where | Purpose |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | build time | Firebase web app config |
| `VITE_FIREBASE_AUTH_DOMAIN` | build time | Firebase OAuth redirect domain |
| `VITE_FIREBASE_PROJECT_ID` | build time | Firebase web project config |
| `VITE_FIREBASE_APP_ID` | build time | Firebase web app config |
| `FIREBASE_PROJECT_ID` | runtime | Firebase Admin project selection |
| `GOOGLE_CLOUD_PROJECT` | runtime | Vertex AI project |
| `GOOGLE_CLOUD_LOCATION` | runtime | Vertex AI region, normally `us-central1` |
| `GEMINI_MODEL_MAIN` | runtime | Main Vertex Gemini model (default `gemini-2.5-flash`) |
| `GEMINI_MODEL_FAST` | runtime | Fast Vertex Gemini model (default `gemini-2.5-flash-lite`) |
| `ANSWER_SIGNING_ACTIVE_KEY_ID` | runtime secret config | ID for the current answer-token encryption key |
| `ANSWER_SIGNING_KEYS_JSON` | runtime secret | JSON object mapping key IDs to random values of at least 32 characters |
| `GOOGLE_API_KEY` | optional runtime secret | Restricted key for optional Google APIs; YouTube requires it |

Generate key material with a cryptographically secure random generator, for example:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Store `ANSWER_SIGNING_KEYS_JSON` in Secret Manager and inject it as a Cloud Run secret environment variable. Never
use a `VITE_` prefix for a secret. To rotate: add a new key ID/value while retaining all old key IDs, set
`ANSWER_SIGNING_ACTIVE_KEY_ID` to the new ID, deploy, then retain old keys until every issued token has expired.
Diagnostic and transfer tokens expire after 24 hours; course-assessment tokens expire after 10 years to preserve
saved course assignments. Remove old keys only after that validity window or after deliberately invalidating old
assignments. The legacy `QUESTION_SIGNING_SECRET` is accepted only as a compatibility fallback and should be
replaced by the key ring.

## 4. Firestore TTL policies and abuse controls

Replay receipts and shared request counters have an `expires_at` Firestore timestamp. Configure TTL for both
collection groups (TTL deletion is asynchronous and is cleanup, not the authorization check):

```sh
gcloud firestore fields ttls update expires_at --collection-group=systemRateLimits --enable-ttl --project=YOUR_FIREBASE_PROJECT_ID
gcloud firestore fields ttls update expires_at --collection-group=answerTokenReplays --enable-ttl --project=YOUR_FIREBASE_PROJECT_ID
```

The app also applies shared per-user request limits in Firestore. Guest request limits use forwarded client IP
headers and therefore depend on a trusted ingress configuration. Put Cloud Run behind Cloud Armor or an equivalent
trusted edge rate limiter for production guest traffic; do not expose the service through an ingress path that lets
clients forge trusted forwarding headers.

## 5. Build and deploy Cloud Run

The Firebase web values are embedded at build time. Pass only the public Firebase config as Docker build arguments.
Keep answer signing keys and optional API keys in Secret Manager at runtime:

```sh
docker build -t REGION-docker.pkg.dev/PROJECT/REPOSITORY/unstuck:TAG ^
  --build-arg VITE_FIREBASE_API_KEY=PUBLIC_API_KEY ^
  --build-arg VITE_FIREBASE_AUTH_DOMAIN=PROJECT.firebaseapp.com ^
  --build-arg VITE_FIREBASE_PROJECT_ID=PROJECT ^
  --build-arg VITE_FIREBASE_APP_ID=WEB_APP_ID .
```

Deploy only after the application checks pass and Firebase setup is complete. For Cloud Run, select the dedicated
runtime service account, set `FIREBASE_PROJECT_ID`, `GOOGLE_CLOUD_PROJECT`, and `GOOGLE_CLOUD_LOCATION`, and mount
`ANSWER_SIGNING_KEYS_JSON` from Secret Manager. Deployment is intentionally not performed as part of this code
change.

## 6. Manual verification checklist

- Test Google sign-in, cancellation, sign-out, revoked/expired token handling, and returning-user restoration on
  the actual authorized domain.
- Use two test accounts to verify server functions cannot read or alter each other's profile, concepts, courses,
  progress, hints, or assessment history.
- Complete guest attempts, sign in, verify imported entries appear as unverified activity, then retry the import;
  it must not duplicate events or upgrade guest-reported results to mastery.
- Verify course creation and position persistence, grading retries, phase advancement, replay prevention, and
  assessment hint counts against the configured Firebase project.
- Test Vertex AI and each optional Google API only when enabled. No live service behavior is proven by unit tests.

Do not run emulator/live integration checks with production user data. No user data migration from Supabase is
included or required for this project.
