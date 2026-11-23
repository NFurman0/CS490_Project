# Scope-Guard Evaluation Set (`S2-004`)

Repeatable evaluation dataset and criteria used to verify that ReviewLens Q&A stays strictly grounded in the active `AnalysisTarget` review dataset (`S2-BR-015` through `S2-BR-021`, `S2-BR-027` through `S2-BR-031`).

## Files

- `evaluation-set.json`: Canonical fixture containing a synthetic `AnalysisTarget` (`Copper Kettle Cafe`, platform `google_maps`), 6 normalized `Review` records matching `@reviewlens/shared`'s `reviewSchema`, and 20 representative evaluation cases across all 5 required scope categories. One active-target review explicitly mentions a competitor and an external platform to test attributed statements against unsupported claims.
- `apps/api/test/helpers/scope-guard-evaluator.ts`: Zod schema validation (`scopeGuardEvaluationSetSchema`), loader (`loadScopeGuardEvaluationSet`), and behavioral response evaluator (`evaluateScopeGuardResponse`, `evaluateScopeGuardSuite`).
- `apps/api/test/helpers/scope-guard-evaluator.test.ts`: Automated Vitest suite verifying dataset completeness, schema invariants, paraphrased acceptable answers, and rejection of hallucinated or out-of-scope responses.

## Categories Covered

| Category                | Expected Outcome        | Stories / Rules                          | Purpose                                                                                                                                               |
| ----------------------- | ----------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `in_scope`              | `grounded_answer`       | `S2-011`, `S2-BR-008`–`014`              | Questions directly supported by the persisted review dataset (complaints, praise, study/Wi-Fi suitability).                                           |
| `insufficient_evidence` | `insufficient_evidence` | `S2-012`, `S2-BR-010`–`011`, `015`       | Domain-relevant questions about the target where the active reviews lack evidence (nighttime parking safety, vegan/gluten-free pastries, pet policy). |
| `general_knowledge`     | `out_of_scope_refusal`  | `S2-014`, `S2-BR-015`–`016`, `019`–`021` | Unrelated world-knowledge or coding questions (weather forecast, Python merge sort, trivia).                                                          |
| `other_entity`          | `out_of_scope_refusal`  | `S2-015`, `S2-BR-017`–`021`              | Questions about another business or cross-entity comparisons absent from the active dataset (`Blue Bottle Coffee`, `Starbucks Reserve`).              |
| `other_platform`        | `out_of_scope_refusal`  | `S2-015`, `S2-BR-017`–`021`              | Questions requesting reviews from unsupported or non-ingested platforms (`Yelp`, `TripAdvisor`, `Amazon`).                                            |

## S2-015 evidence boundary

The sixth synthetic Google Maps review belongs to **Copper Kettle Cafe**. Its reviewer says they preferred Copper Kettle's espresso to Starbucks and incidentally mentions a Yelp link. This is evidence of **one Copper Kettle reviewer's statement**, not a Starbucks review or a Yelp review. The `in-scope-004` case permits an attributed description of that statement; `other-entity-005` asks for an overall winner, which that statement cannot establish. `in-scope-005` checks that an incidental Yelp mention does not block a patio question about the active target.

Other entity/platform cases ask about an unidentified café, another business's customers, Yelp reviews, external ratings, or a mixed Amazon comparison. Their `samplePassingResponse` fields demonstrate scoped refusals, while `sampleFailingResponse` fields contain unsupported assertions the evaluator must reject. Each case records its purpose in `rationale`, its expected model `outcome`, and text criteria. JSON does not allow inline comments, so those fields document the individual cases.

Service tests send the full synthetic active-target review set to a fake model and check its recorded request. HTTP tests seed the isolated test database and verify that the owner-scoped repository supplies only the caller's active target. Both tests control the fake model's answer; they verify wiring and response evaluation, **not** Gemini's independent judgment. The service validates the response shape at runtime but does not run the behavioral evaluator on production answers.

## Behavioral Evaluation Model

Per `S2-004` technical guidance, `evaluateScopeGuardResponse(testCase, responseText)` determines whether an assistant response is acceptable **without requiring one exact sentence**:

1. **Required Concept Groups (`requiredConceptGroups`):** Each group lists acceptable synonyms/keywords; at least one term from each group must appear.
2. **Forbidden Substrings (`forbiddenSubstrings`):** Rejects responses that invent unsupported facts or answer out-of-scope prompts.
3. **Limitation Acknowledgement (`requireLimitationAcknowledgement`):** Ensures `insufficient_evidence` responses explicitly state that the supplied reviews do not contain the requested information.
4. **Scope Refusal (`requireScopeRefusal`):** Ensures `general_knowledge`, `other_entity`, and `other_platform` responses decline the out-of-scope request and reinforce the active ReviewLens dataset boundary.

## Usage in Q&A Test Harnesses (`S2-003`)

The Q&A test harness or evaluation scripts can load the fixture directly:

```ts
import {
  loadScopeGuardEvaluationSet,
  evaluateScopeGuardResponse,
} from '../helpers/scope-guard-evaluator.js';

const evalSet = loadScopeGuardEvaluationSet();
for (const testCase of evalSet.cases) {
  const answer = await qaService.ask(evalSet.target, evalSet.reviews, testCase.question);
  const result = evaluateScopeGuardResponse(testCase, answer);
  expect(result.acceptable, result.reasons.join('; ')).toBe(true);
}
```
