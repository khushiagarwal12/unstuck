<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- AI tutor calls go through one server function (src/lib/tutor.functions.ts) with an action switch; keeps prompts and AI access server-side in one place.
- Model access lives only in src/lib/ai-provider.server.ts. Google Gemini (GEMINI_API_KEY) is the primary provider; the Lovable AI gateway is used only when no Gemini key is set. Do not call a model from anywhere else. Other Google APIs (Text-to-Speech, Translation, YouTube) live in src/lib/google-apis.server.ts and are exposed through src/lib/google.functions.ts; each feature must stay hidden when its credentials are missing (see getCapabilities). Keep Google products as the default for any new capability.
- Every model reply is validated with zod (src/lib/tutor-schemas.ts). Quiz answer keys are only served after an independent second solve agrees (src/lib/tutor-core.ts). Do not bypass either.
- Learner state (profile, concepts, courses) lives in Lovable Cloud tables protected by row-level security; mastery status is computed by the app from recorded attempts, never written by the model.
- Test doubles belong in src/test only. Application code has no fake or canned AI content: when the model fails, show a clear retryable error or hide the feature.
