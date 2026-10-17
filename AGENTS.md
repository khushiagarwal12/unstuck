- AI tutor calls go through `src/lib/tutor.functions.ts`; model access is server-only in
  `src/lib/ai-provider.server.ts` and uses Gemini on Vertex AI with Application Default Credentials.
- Google Text-to-Speech, Translation and YouTube calls live in `src/lib/google-apis.server.ts` and are exposed
  through `src/lib/google.functions.ts`. Hide optional features when their configured credentials are absent.
- Validate every model reply with Zod in `src/lib/tutor-schemas.ts`. Never return answer keys or assessment
  rubrics to the browser before grading.
- Firebase Authentication ID tokens must be verified in `src/integrations/firebase/auth-middleware.ts`.
  Firestore access uses the UID from verified token context, never a client-provided owner ID. Firestore client
  rules remain deny-all; learner data is accessed only through server functions.
- Mastery and phase completion are derived from server-verified answers and saved assessment attempts. Never
  accept client-authored grades, mastery status or completed-phase state.
- Test doubles belong in `src/test` only. Application code must not provide fake or canned AI content; surface a
  clear retryable error when configured services fail.
