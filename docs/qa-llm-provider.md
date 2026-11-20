# Q&A LLM Provider

How ReviewLens calls an LLM to answer questions about a target's reviews. For how the reviews are selected, see `docs/qa-context.md`. For testing without a live model, see `docs/qa-test-harness.md`.

## Gemini

ReviewLens uses Google's **Gemini API** on its **free tier**, with a stable **Flash** model.

- **Cost.** The free tier needs no billing, and current Flash models are free of charge. OpenAI and Anthropic, named in the original architecture baseline, have no standing free API tier.
- **Fit.** A typical question sends about 5–8k tokens (up to the 40k context budget). Flash models handle this easily, return JSON constrained to a schema, and answer in seconds.
- **Data use.** Google's pricing page states that free-tier requests may be used to improve Google products. Reviews are public Google Maps reviews and questions are about them, but the team and instructor should be aware of this.

The model sits behind the `QaModel` interface (`apps/api/src/modules/qa/qa-model.ts`), so another provider can be added as a new adapter without changing the rest of the Q&A code.

## Configuration (`apps/api/.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | required | Secret. Created in Google AI Studio; server-side only |
| `LLM_MODEL` | `gemini-3.8-flash` | A stable (non-preview) model listed in Google AI Studio |
| `LLM_TIMEOUT_MS` | `30000` | Give up on a Gemini request after this long, including retries |
| `LLM_THINKING_LEVEL` | `low` | How much Gemini 3 models reason before answering. Higher levels are slower and can hit the timeout; use `off` for Gemini 2.5 models |
| `QA_CONTEXT_TOKEN_BUDGET` | `40000` | Estimated tokens of review context per question |

**Getting a key:** sign in to Google AI Studio with a personal Google account, open **API Keys**, and create a key. New keys are restricted to the Gemini API by default. Do not enable billing, so the project stays on the free tier.

**Free-tier limits are per Google project**, shown in AI Studio's rate-limit page. Each developer should use their own project for development. Keep a separate project for the demo so nobody uses up its daily limit beforehand.

## Endpoint

`POST /api/analysis-targets/:targetId/qa`, called by the web app's `askQuestion()`.

| Request / result | Response |
| --- | --- |
| `{ "question": "…" }`, 1–1,000 characters | `200` with `{ data: { target, outcome, answer, reviewCount, context } }` |
| Empty, too long, or extra fields such as `ownerId` | `400 VALIDATION_FAILED` |
| Signed out | `401 UNAUTHENTICATED` |
| Missing target, another user's target, or a malformed ID | `404 NOT_FOUND` (the model is never called) |
| Target with no reviews | `200` with `outcome: "no_review_data"` (the model is never called) |
| Gemini error, timeout, rate limit, blocked prompt, or unusable answer | `503 AI_SERVICE_UNAVAILABLE` |

Request and response schemas are shared in `packages/shared/src/qa.ts`.

## Switching models or providers

- **Another Gemini model:** change `LLM_MODEL` and restart. Try Flash-Lite if Flash's free limits are too tight.
- **Another provider:** add an adapter that implements `QaModel`, using `buildUserMessage()` and `buildSystemPrompt()`, and select it in `apps/api/src/server.ts`.
