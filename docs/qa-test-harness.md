# Deterministic Q&A Test Harness 

ReviewLens Q&A is tested without calling a live LLM. CI never pays for model calls and never depends on a model's exact wording.

## Model Boundary 

The Q&A service (`apps/api/src/modules/qa/qa.service.ts`) reaches the LLM only through the `QaModel` interface in `apps/api/src/modules/qa/qa-model.ts`:

```ts
interface QaModel {
  complete(request: QaModelRequest): Promise<QaModelResponse>;
}
```

| Request field | Contents |
| --- | --- |
| `systemPrompt` | Built per question by `buildSystemPrompt(target)` in `system-prompt.ts` |
| `target` | The active target's name and platform |
| `reviews` | The active target's persisted reviews. `id`, `rating`, `text`, `reviewerName`, `publishedAt` fields only. Owner IDs, target IDs, URLs, and provider metadata never cross the boundary |
| `question` | The user's question |

Every adapter must return `{ outcome, answer }`, where `outcome` is `grounded_answer`, `insufficient_evidence`, or `out_of_scope_refusal`. The service validates the response with `qaModelResponseSchema`. Anything else, and any thrown provider error, becomes `AI_SERVICE_UNAVAILABLE` (HTTP 503) with a user-safe message.

## Protecting Context

For every question, `ask(ownerId, targetId, question)`:

1. Checks ownership with `getOwnedTargetOrThrow`. Another user's target fails with `NOT_FOUND` before any review is read or the model is called.
2. Loads reviews for that owned target from the database. Nothing is cached between questions, so a previous target's reviews cannot carry over.
3. Returns `no_review_data` without calling the model when the target has no reviews.

## Developing Tests

`apps/api/test/helpers/fake-qa-model.ts` provides `createFakeQaModel()`. It records every request and returns whatever the test chooses.

```ts
const fake = createFakeQaModel();
const service = createQaService({ targets, reviews, model: fake.model, logger });

fake.respondWith({ outcome: 'insufficient_evidence', answer: 'The reviews do not mention parking.' });
const result = await service.ask(ownerId, targetId, 'Is parking safe at night?');

expect(fake.lastRequest().systemPrompt).toContain('Copper Kettle Cafe');  // system instructions
expect(fake.suppliedReviewIds()).toEqual(expectedIds);                   // correct context
expect(fake.everythingSent()).not.toContain(OTHER_TARGET_PHRASE);        // no wrong-target or cross-user data
expect(result.outcome).toBe('insufficient_evidence');                    // app behavior for a controlled response
```

| Helper | Use |
| --- | --- |
| `lastRequest()`, `requests` | Inspect exactly what was sent |
| `suppliedReviewIds()` | The review IDs in the latest request |
| `everythingSent()` | All requests as one string, for "this phrase never reached the model" checks |
| `respondWith(response \| fn)` | Return a fixed or computed response |
| `failWith(error)` | Simulate a timeout or outage |
| `returnMalformed(value)` | Simulate output that breaks the response contract |

For database-backed tests, `test/helpers/qa-fixtures.ts` provides `seedTargetWithReviews(clerkUserId, name, reviews)`. Give each dataset a distinctive phrase so a leak is easy to detect.

## Live-model evaluation

Real-model checks against the evaluation set are supplementary and run outside CI. They need the real provider adapter.
