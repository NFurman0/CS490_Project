import { describe, expect, it } from 'vitest';
import {
  evaluateScopeGuardResponse,
  evaluateScopeGuardSuite,
  loadScopeGuardEvaluationSet,
  SCOPE_GUARD_CATEGORIES,
  scopeGuardEvaluationSetSchema,
} from './scope-guard-evaluator.js';

describe('Scope-Guard Evaluation Set (S2-004)', () => {
  const evaluationSet = loadScopeGuardEvaluationSet();

  it('validates the canonical evaluation set fixture against the schema', () => {
    expect(evaluationSet.target.name).toBe('Copper Kettle Cafe');
    expect(evaluationSet.target.platform).toBe('google_maps');
    expect(evaluationSet.reviews.length).toBeGreaterThanOrEqual(5);
    expect(evaluationSet.cases.length).toBeGreaterThanOrEqual(10);
  });

  it.each(SCOPE_GUARD_CATEGORIES)(
    'includes multiple representative questions for required category %s',
    (category) => {
      const matchingCases = evaluationSet.cases.filter((c) => c.category === category);
      expect(matchingCases.length).toBeGreaterThanOrEqual(2);
    },
  );

  it('accepts every case samplePassingResponse without requiring a single rigid wording', () => {
    const summary = evaluateScopeGuardSuite(
      evaluationSet,
      (testCase) => testCase.samplePassingResponse,
    );

    expect(summary.allAcceptable).toBe(true);
    expect(summary.failedCases).toBe(0);
    expect(summary.passedCases).toBe(evaluationSet.cases.length);
  });

  it('accepts paraphrased responses that satisfy behavioral criteria across categories', () => {
    const inScopeCase = evaluationSet.cases.find((c) => c.id === 'in-scope-001');
    const insufficientCase = evaluationSet.cases.find((c) => c.id === 'insufficient-evidence-001');
    const generalCase = evaluationSet.cases.find((c) => c.id === 'general-knowledge-001');
    const entityCase = evaluationSet.cases.find((c) => c.id === 'other-entity-001');
    const platformCase = evaluationSet.cases.find((c) => c.id === 'other-platform-001');

    if (!inScopeCase || !insufficientCase || !generalCase || !entityCase || !platformCase) {
      throw new Error('Expected representative cases in evaluation set');
    }

    expect(
      evaluateScopeGuardResponse(
        inScopeCase,
        'Based on the reviews, guests complain about long weekend wait times in line and sticky patio tables.',
      ).acceptable,
    ).toBe(true);

    expect(
      evaluateScopeGuardResponse(
        insufficientCase,
        'There is no mention of parking lot safety at night in the available reviews.',
      ).acceptable,
    ).toBe(true);

    expect(
      evaluateScopeGuardResponse(
        generalCase,
        'I cannot answer weather questions; I only analyze the reviews in the active Copper Kettle Cafe dataset.',
      ).acceptable,
    ).toBe(true);

    expect(
      evaluateScopeGuardResponse(
        entityCase,
        'I can only answer questions about Copper Kettle Cafe from its active review dataset, not other businesses like Blue Bottle.',
      ).acceptable,
    ).toBe(true);

    expect(
      evaluateScopeGuardResponse(
        platformCase,
        'The active dataset only contains Google Maps reviews, so I cannot report on Yelp reviews.',
      ).acceptable,
    ).toBe(true);
  });

  it('rejects every case sampleFailingResponse when scope or evidence rules are violated', () => {
    for (const testCase of evaluationSet.cases) {
      const result = evaluateScopeGuardResponse(testCase, testCase.sampleFailingResponse);
      expect(result.acceptable).toBe(false);
      expect(result.reasons.length).toBeGreaterThan(0);
    }
  });

  it('rejects empty responses or missing suite responses', () => {
    const firstCase = evaluationSet.cases[0];
    if (!firstCase) throw new Error('Expected at least one evaluation case');

    const emptyResult = evaluateScopeGuardResponse(firstCase, '   ');
    expect(emptyResult.acceptable).toBe(false);
    expect(emptyResult.reasons).toContain('Response is empty.');

    const missingSummary = evaluateScopeGuardSuite(evaluationSet, () => undefined);
    expect(missingSummary.allAcceptable).toBe(false);
    expect(missingSummary.failedCases).toBe(evaluationSet.cases.length);
  });

  it('rejects an evaluation set missing multiple examples in any required category', () => {
    const incompleteSet = {
      ...evaluationSet,
      cases: evaluationSet.cases.filter((c) => c.category !== 'other_platform'),
    };

    const parsed = scopeGuardEvaluationSetSchema.safeParse(incompleteSet);
    expect(parsed.success).toBe(false);
  });

  it('rejects duplicate case IDs or reviews belonging to a different targetId', () => {
    const firstCase = evaluationSet.cases[0];
    const secondCase = evaluationSet.cases[1];
    const firstReview = evaluationSet.reviews[0];
    if (!firstCase || !secondCase || !firstReview) {
      throw new Error('Expected fixture cases and reviews');
    }

    const duplicateIds = {
      ...evaluationSet,
      cases: [firstCase, { ...secondCase, id: firstCase.id }, ...evaluationSet.cases.slice(2)],
    };
    expect(scopeGuardEvaluationSetSchema.safeParse(duplicateIds).success).toBe(false);

    const mismatchedReviewTarget = {
      ...evaluationSet,
      reviews: [
        { ...firstReview, targetId: '99999999-9999-4999-8999-999999999999' },
        ...evaluationSet.reviews.slice(1),
      ],
    };
    expect(scopeGuardEvaluationSetSchema.safeParse(mismatchedReviewTarget).success).toBe(false);
  });

  it('rejects cases whose expectedOutcome or flags contradict their category rules', () => {
    const firstCase = evaluationSet.cases[0];
    if (!firstCase) throw new Error('Expected at least one case');

    const mismatchedOutcome = {
      ...evaluationSet,
      cases: [
        {
          ...firstCase,
          category: 'general_knowledge' as const,
          expectedOutcome: 'grounded_answer' as const,
        },
        ...evaluationSet.cases.slice(1),
      ],
    };

    expect(scopeGuardEvaluationSetSchema.safeParse(mismatchedOutcome).success).toBe(false);
  });
});
