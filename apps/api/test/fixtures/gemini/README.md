# Gemini response fixtures

Shaped like `generateContent` responses from the Gemini REST API, used by `src/adapters/gemini/gemini-qa-model.test.ts`. Tests never call Gemini.

- `answer-success.json`: a JSON-mode answer with `outcome` and `answer`.
- `prompt-blocked.json`: the prompt was blocked (`promptFeedback.blockReason`).
- `error-rate-limited.json`: the error body returned with HTTP 429 when free-tier limits are exceeded.

These were written from the documented response format, not recorded. Once someone has a key, replace `answer-success.json` with a real response saved from a `generateContent` call (for example with `curl`, keeping the review data fictional), using the same file name, and check the adapter tests still pass.
