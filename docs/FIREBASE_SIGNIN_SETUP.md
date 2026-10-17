# Firebase Google Sign-In Setup Guide

This guide explains how to configure Firebase Authentication for Google sign-in in UNSTUCK.

## Prerequisite: Firebase Project

You must have a Firebase project linked to a Google Cloud project. If you don't have one:

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" or select an existing project
3. Link it to your Google Cloud project (or create a new one)
4. Use the same project for Firebase Auth, Firestore, and Vertex AI

## Step 1: Enable Google Authentication Provider

1. In Firebase Console, go to **Authentication** → **Sign-in method**
2. Click on **Google**
3. Enable the toggle
4. Enter a **Project support email** (required for OAuth consent)
5. Click **Save**

## Step 2: Configure Authorized Domains

1. In Firebase Console, go to **Authentication** → **Settings** → **Authorized domains**
2. Add the following domains:
   - `localhost` (for local development)
   - Your production domain (e.g., `your-app.com`)
   - Any staging or testing domains
3. Click **Save**

**Why this matters:** Firebase OAuth uses the configured `authDomain` for redirect handling. If your domain is not in this list, Google sign-in will fail with an "unauthorized domain" error.

## Step 3: Register Web App and Get Configuration

1. In Firebase Console, go to **Project settings** → **General** → **Your apps**
2. Click the **</>** (Web) icon to add a Web app
3. Give it a name (e.g., "UNSTUCK Web")
4. **Do NOT** enable Firebase Hosting for this setup (unless you're using it)
5. Click **Register app**
6. Copy the following values from the "Firebase SDK snippet" section:

```javascript
const firebaseConfig = {
  apiKey: "AIza...",              // → VITE_FIREBASE_API_KEY
  authDomain: "project.firebaseapp.com",  // → VITE_FIREBASE_AUTH_DOMAIN
  projectId: "project-id",        // → VITE_FIREBASE_PROJECT_ID
  appId: "1:123456789:web:abc"   // → VITE_FIREBASE_APP_ID
};
```

7. Click **Continue to console**

## Step 4: Create Firestore Database

1. In Firebase Console, go to **Firestore Database**
2. Click **Create database**
3. Select **Native mode** (recommended for production)
4. Choose a location (ideally the same region as your Cloud Run service)
5. Click **Create database**

### Deploy Security Rules

The repository includes `firestore.rules` which deny all direct browser access. To deploy:

```bash
# Install Firebase CLI if not already installed
npm install -g firebase-tools

# Login to Firebase
firebase login

# Deploy only the Firestore rules (not the full project)
firebase deploy --only firestore:rules --project YOUR_PROJECT_ID
```

The rules file is located at `firestore.rules` in the repository root and points to this file via `firebase.json`.

## Step 5: Configure Local Environment

1. Copy the example environment file:

```bash
# On Windows
copy .env.example .env

# On macOS/Linux
cp .env.example .env
```

2. Edit `.env` and fill in the four required Firebase values:

```env
VITE_FIREBASE_API_KEY=AIza...              # From Step 3
VITE_FIREBASE_AUTH_DOMAIN=project.firebaseapp.com  # From Step 3
VITE_FIREBASE_PROJECT_ID=project-id        # From Step 3
VITE_FIREBASE_APP_ID=1:123456789:web:abc   # From Step 3
```

3. Fill in the server-side configuration:

```env
FIREBASE_PROJECT_ID=project-id             # Same as VITE_FIREBASE_PROJECT_ID
GOOGLE_CLOUD_PROJECT=project-id            # Same as Firebase project ID
GOOGLE_CLOUD_LOCATION=us-central1          # Your Firestore region
```

4. Generate signing keys for answer tokens:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Use the output for `ANSWER_SIGNING_KEYS_JSON`:

```env
ANSWER_SIGNING_ACTIVE_KEY_ID=current
ANSWER_SIGNING_KEYS_JSON={"current":"BASE64_KEY_FROM_ABOVE"}
```

5. Restart your development server:

```bash
npm run dev
```

## Step 6: Configure Google Cloud IAM (for Vertex AI and Firestore)

### For Local Development

Install Google Cloud CLI and authenticate:

```bash
# Install gcloud CLI
# (Follow instructions at https://cloud.google.com/sdk/docs/install)

# Authenticate
gcloud auth application-default login

# Set project
gcloud config set project YOUR_PROJECT_ID
```

### For Cloud Run Deployment

1. Create a dedicated service account in Google Cloud Console
2. Grant the following IAM roles:
   - `roles/datastore.user` (Firestore read/write)
   - `roles/aiplatform.user` (Vertex AI access)
   - `roles/firebaseauth.viewer` (Token revocation checks)
   - `roles/serviceusage.serviceUsageConsumer` (if required by project policy)

3. Attach this service account to your Cloud Run service as the runtime identity

## Step 7: Enable Required APIs

In Google Cloud Console, ensure these APIs are enabled:

- **Cloud Firestore API**
- **Vertex AI API**
- **Firebase Authentication API** (usually enabled by Firebase)

## Step 8: Verify Configuration

### Check 1: Application detects Firebase is configured

1. Start the dev server: `npm run dev`
2. Open http://localhost:3000
3. You should **NOT** see the message "Google sign-in is not configured yet"
4. The "Continue with Google" button should be visible

### Check 2: Google sign-in works

1. Click "Continue with Google"
2. A Google OAuth popup should appear
3. Sign in with your Google account
4. You should be redirected back to the app
5. You should see your signed-in state (not the guest notice)

### Check 3: Server functions work

1. After signing in, navigate to the dashboard
2. Create a course or save profile settings
3. Verify data is persisted to Firestore (check Firebase Console → Firestore Database)

### Check 4: Guest mode still works

1. Sign out
2. Click "Try as guest" or "Start a learning check"
3. Complete a diagnostic attempt
4. Verify it saves to local storage
5. Sign in again
6. Verify guest progress is imported as "unverified-guest-history"

## Troubleshooting

### "Google sign-in is not configured yet"

**Cause:** One or more `VITE_FIREBASE_*` environment variables are missing or empty.

**Fix:**
1. Check `.env` exists
2. Verify all four variables are set
3. Restart the dev server (environment variables are read at build time)

### "unauthorized_domain" error

**Cause:** Your domain is not in Firebase Auth authorized domains list.

**Fix:**
1. Go to Firebase Console → Authentication → Settings → Authorized domains
2. Add your domain (e.g., `localhost` for dev, your production domain)
3. Save and retry

### "popup-closed-by-user" error

**Cause:** User closed the Google popup, or popup was blocked by browser.

**Fix:**
1. Ensure popups are allowed for localhost in your browser
2. Check if any browser extensions are blocking popups
3. This is normal if the user cancels - the app handles this gracefully

### "Firebase is not configured. Missing X, Y, Z" error

**Cause:** Firebase client initialization detected missing configuration.

**Fix:**
1. Check the error message for which specific variables are missing
2. Add them to `.env`
3. Restart the dev server

### Server functions return 401 Unauthorized

**Cause:** Firebase ID token verification failed (expired, revoked, or malformed).

**Fix:**
1. Ensure Firebase Auth is properly configured
2. Check that the user is actually signed in
3. Verify server-side `FIREBASE_PROJECT_ID` matches your Firebase project
4. Check browser console for detailed error messages

## Security Notes

- **Never commit `.env` to Git** - it contains public config but establishes the pattern for secrets
- **`VITE_FIREBASE_*` values are public** - they are bundled into the browser bundle
- **Server-side variables are runtime secrets** - use Secret Manager in Cloud Run
- **`ANSWER_SIGNING_KEYS_JSON` must be secure** - generate with strong random values
- **Never use `GOOGLE_ACCESS_TOKEN` in production** - it's for local dev only

## Deployment (Cloud Run)

For Cloud Run deployment, the Firebase web config is passed as build arguments:

```bash
docker build -t REGION-docker.pkg.dev/PROJECT/REPOSITORY/unstuck:TAG \
  --build-arg VITE_FIREBASE_API_KEY=PUBLIC_API_KEY \
  --build-arg VITE_FIREBASE_AUTH_DOMAIN=PROJECT.firebaseapp.com \
  --build-arg VITE_FIREBASE_PROJECT_ID=PROJECT \
  --build-arg VITE_FIREBASE_APP_ID=WEB_APP_ID .
```

Runtime secrets (`ANSWER_SIGNING_KEYS_JSON`, `GOOGLE_API_KEY`) should be injected from Secret Manager, not build arguments.

## Additional Resources

- [Firebase Authentication Documentation](https://firebase.google.com/docs/auth)
- [Firebase Web Setup Guide](https://firebase.google.com/docs/web/setup)
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started)
- [Google Cloud Application Default Credentials](https://cloud.google.com/docs/authentication/adc)
