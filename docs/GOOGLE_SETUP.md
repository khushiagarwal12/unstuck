# Google services setup

Everything below uses your Google Cloud project (the one with the $300 trial). Do each step once.

## 1. Enable the APIs
Console → APIs & Services → Library, enable:
- Generative Language API (for a Gemini API key) and/or Vertex AI API
- Cloud Text-to-Speech API
- Cloud Translation API
- YouTube Data API v3

## 2. Create credentials
- **API key** (APIs & Services → Credentials → Create credentials → API key). Restrict it to Text-to-Speech,
  Cloud Translation and YouTube Data API v3. Save it as `GOOGLE_API_KEY`.
- **Gemini:** either a Google AI Studio key as `GEMINI_API_KEY`, or Vertex AI: set `LLM_BACKEND=vertex`,
  `GOOGLE_CLOUD_PROJECT`, and a service account JSON (role *Vertex AI User*) as `GOOGLE_SERVICE_ACCOUNT_JSON`.
- Set a budget alert (Billing → Budgets) at about $50 and $150 so trial credits are not a surprise.

## 3. Add the secrets
Lovable: project settings → secrets. Local: `GEMINI_API_KEY=... GOOGLE_API_KEY=... npm run dev`.

Features switch on by themselves: with no `GOOGLE_API_KEY` the Listen, Translate and Video buttons are hidden;
with no Gemini or Vertex credentials, photo reading is hidden.

## 4. Optional: host on Google Cloud Run
```sh
gcloud run deploy unstuck --source . --region us-central1 --allow-unauthenticated \
  --set-env-vars LLM_BACKEND=vertex,GOOGLE_CLOUD_PROJECT=<project>,SUPABASE_URL=<url>,SUPABASE_PUBLISHABLE_KEY=<key> \
  --set-secrets GOOGLE_API_KEY=google-api-key:latest,GOOGLE_SERVICE_ACCOUNT_JSON=vertex-sa:latest
```
Notes: on Cloud Run the runtime service account can be given the *Vertex AI User* role, but this app signs in with a
service account JSON so it works the same on every host. Google sign-in goes through Lovable's auth, which may only
allow Lovable domains; test sign-in on the Lovable URL.
