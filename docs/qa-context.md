# Q&A Review Context

Every question sends **all** of the active target's reviews, with duplicates removed, as long as they fit the token budget. Only when they do not fit is a subset selected.

We chose this over retrieval (RAG with embeddings and vector search) because:

- **The datasets are small.** Ingestion collects at most `MAX_REVIEWS_PER_RUN` reviews per run (50 by default, 500 maximum). At roughly 100–150 tokens per review, a default run is about 5–8k tokens.
- **The core questions are about the whole dataset.** "What complaints appear most often?" or "What themes appear in low-rated reviews?" need every review. Retrieving the few reviews most similar to the question would misjudge frequency and add additonal latency.
- **No extra services.** Retrieval would need an embedding provider and key, embedding at ingestion time, and the `pgvector` extension, which the `postgres:17` images used locally and in CI do not include.

If datasets grow well beyond the budget, RAG-based retrieval can replace `buildReviewContext()` without changing the rest of the Q&A code.

## How context is built

`buildReviewContext()` in `apps/api/src/modules/qa/qa-context.ts`, called by the Q&A service for every question:

1. **Ownership and target.** The service first checks that the caller owns the target, then loads that target's reviews from the database with an owner-scoped query. Context only ever comes from persisted ReviewLens data for the active, owned target.
2. **No carry-over.** Context is rebuilt from the database for every question. Nothing is cached, so a previously selected target's reviews cannot remain.
3. **Duplicates removed.** Re-running ingestion stores reviews again. Reviews are the same when their source review ID matches or, without one, their rating and normalized text match. The latest stored copy is kept, so edits a reviewer made between ingestion runs are reflected.  
4. **Budget.** If the estimated size exceeds the budget, reviews are selected round-robin across star ratings (1 to 5), newest first within each rating. A review that does not fit is skipped in favor of a shorter one. The result is deterministic.

## Size and token limits

| Setting | Value | Where |
| --- | --- | --- |
| Context budget | 40,000 estimated tokens | `DEFAULT_CONTEXT_TOKEN_BUDGET`, overridable with the service's `contextTokenBudget` option |
| Token estimate | 4 characters per token, plus 25 tokens per review | `estimateReviewTokens()` |
| Typical default run | 50 reviews, about 5–8k tokens | Fits without trimming |
| Budget reached at | roughly 250–300 typical reviews | Several large or repeated ingestion runs |

The estimate is deliberately conservative and provider-independent. The real model's context window must comfortably exceed the budget plus the system prompt, question, and answer. 

## When context is trimmed

The model request includes `availableReviewCount`, and the service's answer includes `context: { reviewsUsed, truncated }`. When `truncated` is true:

- The Q&A interface should tell the user the answer is based on a subset (for example, "Based on 280 of 412 reviews").
- The system prompt can use `availableReviewCount` to tell the model it is seeing a sample.
- The service logs the target ID, counts, and estimated tokens at `info` level.

## Tests

- `apps/api/src/modules/qa/qa-context.test.ts`: all reviews when within budget, minimal fields, duplicate removal (by source ID and by text), trimming and reporting, rating balance, newest-first, skipping oversized reviews, determinism, and a 50-review run fitting the default budget.
- `apps/api/test/integration/qa-context.test.ts` (test database): duplicates from repeated ingestion sent once, context reflects current persisted reviews on every question, and trimming reported to the caller.
- Ownership, wrong-target, cross-user, and target-switching tests are in `test/integration/qa-harness.test.ts`.

## Web integration status

The web workspace expects `POST /api/analysis-targets/:targetId/qa` with `{ "question": string }` and the `QaAnswer` shape returned by `createQaService`. The current API server does not mount a Q&A route or configure a production `QaModel` adapter, so this client contract cannot return live answers until that backend integration is implemented.
