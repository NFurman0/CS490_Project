import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewSchema } from '@reviewlens/shared';
import { z } from 'zod';

/**
 * Required categories for S2-004 (Create Scope-Guard Evaluation Set).
 * Maps to rules S2-BR-015 through S2-BR-021 and S2-BR-027 through S2-BR-031.
 */
export const SCOPE_GUARD_CATEGORIES = [
  'in_scope',
  'insufficient_evidence',
  'general_knowledge',
  'other_entity',
  'other_platform',
] as const;

export const scopeGuardCategorySchema = z.enum(SCOPE_GUARD_CATEGORIES);
export type ScopeGuardCategory = z.infer<typeof scopeGuardCategorySchema>;

export const SCOPE_GUARD_EXPECTED_OUTCOMES = [
  'grounded_answer',
  'insufficient_evidence',
  'out_of_scope_refusal',
] as const;

export const scopeGuardExpectedOutcomeSchema = z.enum(SCOPE_GUARD_EXPECTED_OUTCOMES);
export type ScopeGuardExpectedOutcome = z.infer<typeof scopeGuardExpectedOutcomeSchema>;

export const scopeGuardCriteriaSchema = z
  .object({
    /**
     * Each inner array represents a concept group; at least one keyword/phrase
     * from every group must appear in the response (case-insensitive).
     */
    requiredConceptGroups: z.array(z.array(z.string().trim().min(1)).min(1)).min(1),
    /**
     * Substrings that must NOT appear in the response (e.g., hallucinated facts
     * or fabricated out-of-scope answers).
     */
    forbiddenSubstrings: z.array(z.string().trim().min(1)),
    /**
     * When true, the response must explicitly acknowledge that the review dataset
     * lacks sufficient evidence to answer the question (S2-012).
     */
    requireLimitationAcknowledgement: z.boolean(),
    /**
     * When true, the response must clearly decline the out-of-scope request and
     * state the active ReviewLens scope (S2-014, S2-015).
     */
    requireScopeRefusal: z.boolean(),
  })
  .strict();

export type ScopeGuardCriteria = z.infer<typeof scopeGuardCriteriaSchema>;

export const scopeGuardCaseSchema = z
  .object({
    id: z.string().trim().min(1),
    category: scopeGuardCategorySchema,
    question: z.string().trim().min(1),
    expectedOutcome: scopeGuardExpectedOutcomeSchema,
    rationale: z.string().trim().min(1),
    criteria: scopeGuardCriteriaSchema,
    samplePassingResponse: z.string().trim().min(1),
    sampleFailingResponse: z.string().trim().min(1),
  })
  .strict()
  .superRefine((testCase, ctx) => {
    const expectedByCategory: Record<ScopeGuardCategory, ScopeGuardExpectedOutcome> = {
      in_scope: 'grounded_answer',
      insufficient_evidence: 'insufficient_evidence',
      general_knowledge: 'out_of_scope_refusal',
      other_entity: 'out_of_scope_refusal',
      other_platform: 'out_of_scope_refusal',
    };

    const expectedOutcome = expectedByCategory[testCase.category];
    if (testCase.expectedOutcome !== expectedOutcome) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedOutcome'],
        message: `Category "${testCase.category}" must use expectedOutcome "${expectedOutcome}".`,
      });
    }

    if (
      testCase.category === 'insufficient_evidence' &&
      !testCase.criteria.requireLimitationAcknowledgement
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['criteria', 'requireLimitationAcknowledgement'],
        message: 'Insufficient-evidence cases must require limitation acknowledgement.',
      });
    }

    if (
      (testCase.category === 'general_knowledge' ||
        testCase.category === 'other_entity' ||
        testCase.category === 'other_platform') &&
      !testCase.criteria.requireScopeRefusal
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['criteria', 'requireScopeRefusal'],
        message: 'Out-of-scope categories must require a scope refusal.',
      });
    }
  });

export type ScopeGuardCase = z.infer<typeof scopeGuardCaseSchema>;

export const scopeGuardTargetSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1),
    platform: z.literal('google_maps'),
    sourceUrl: z.string().url(),
  })
  .strict();

export type ScopeGuardTarget = z.infer<typeof scopeGuardTargetSchema>;

export const scopeGuardEvaluationSetSchema = z
  .object({
    datasetVersion: z.string().trim().min(1),
    target: scopeGuardTargetSchema,
    reviews: z.array(reviewSchema).min(1),
    cases: z.array(scopeGuardCaseSchema).min(10),
  })
  .strict()
  .superRefine((dataset, ctx) => {
    const seenIds = new Set<string>();
    for (const [index, testCase] of dataset.cases.entries()) {
      if (seenIds.has(testCase.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cases', index, 'id'],
          message: `Duplicate evaluation case id "${testCase.id}".`,
        });
      }
      seenIds.add(testCase.id);
    }

    for (const [index, review] of dataset.reviews.entries()) {
      if (review.targetId !== dataset.target.id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reviews', index, 'targetId'],
          message: `Review "${review.id}" must belong to evaluation target "${dataset.target.id}".`,
        });
      }
    }

    for (const category of SCOPE_GUARD_CATEGORIES) {
      const count = dataset.cases.filter((c) => c.category === category).length;
      if (count < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cases'],
          message: `Category "${category}" must contain at least 2 evaluation examples (found ${count}).`,
        });
      }
    }
  });

export type ScopeGuardEvaluationSet = z.infer<typeof scopeGuardEvaluationSetSchema>;

const LIMITATION_SIGNAL_PATTERNS: readonly RegExp[] = [
  /\bdo(?:es)?\s+not\s+(?:mention|contain|include|state|specify|provide|discuss|have)\b/i,
  /\bnone\s+of\s+the\s+(?:ingested\s+|active\s+|supplied\s+)?reviews?\s+(?:mention|contain|include|state|specify|provide|discuss)\b/i,
  /\bno\s+(?:mention|information|evidence|reviews?|details?|data)\b/i,
  /\binsufficient\s+(?:evidence|information|data)\b/i,
  /\bnot\s+(?:mentioned|stated|included|found|covered|available)\b/i,
  /\bcan(?:not|'t)\s+(?:determine|confirm|verify|answer|say)\b/i,
];

const REFUSAL_SIGNAL_PATTERNS: readonly RegExp[] = [
  /\b(?:only|exclusively)\s+(?:answer|analyze|assist|respond|scoped|use|contain|contains|comes?\s+from)\b/i,
  /\bcan(?:not|'t)\s+(?:answer|provide|report|compare|write|fulfill|access)\b/i,
  /\bdo(?:es)?\s+not\s+(?:have\s+access|have\s+review\s+data|include\s+reviews)\b/i,
  /\boutside\s+(?:of\s+)?(?:reviewlens\s+)?scope\b/i,
  /\bunrelated\s+to\b/i,
];

export interface ScopeGuardEvaluationResult {
  caseId: string;
  category: ScopeGuardCategory;
  expectedOutcome: ScopeGuardExpectedOutcome;
  acceptable: boolean;
  reasons: string[];
}

/**
 * Evaluates whether a candidate Q&A response satisfies a Scope-Guard evaluation
 * case's behavioral criteria without requiring a single exact sentence (S2-004).
 */
export function evaluateScopeGuardResponse(
  testCase: ScopeGuardCase,
  responseText: string,
): ScopeGuardEvaluationResult {
  const reasons: string[] = [];
  const normalized = responseText.trim();

  if (normalized.length === 0) {
    return {
      caseId: testCase.id,
      category: testCase.category,
      expectedOutcome: testCase.expectedOutcome,
      acceptable: false,
      reasons: ['Response is empty.'],
    };
  }

  const lower = normalized.toLowerCase();

  for (const group of testCase.criteria.requiredConceptGroups) {
    const matched = group.some((term) => lower.includes(term.toLowerCase()));
    if (!matched) {
      reasons.push(`Missing required concept from group: [${group.join(', ')}].`);
    }
  }

  for (const forbidden of testCase.criteria.forbiddenSubstrings) {
    if (lower.includes(forbidden.toLowerCase())) {
      reasons.push(`Contains forbidden or hallucinated content: "${forbidden}".`);
    }
  }

  if (testCase.criteria.requireLimitationAcknowledgement) {
    const hasLimitationSignal = LIMITATION_SIGNAL_PATTERNS.some((pattern) =>
      pattern.test(normalized),
    );
    if (!hasLimitationSignal) {
      reasons.push(
        'Response does not acknowledge that the active review dataset lacks evidence to answer.',
      );
    }
  }

  if (testCase.criteria.requireScopeRefusal) {
    const hasRefusalSignal = REFUSAL_SIGNAL_PATTERNS.some((pattern) => pattern.test(normalized));
    if (!hasRefusalSignal) {
      reasons.push('Response does not clearly decline the out-of-scope request.');
    }
  }

  return {
    caseId: testCase.id,
    category: testCase.category,
    expectedOutcome: testCase.expectedOutcome,
    acceptable: reasons.length === 0,
    reasons,
  };
}

export interface ScopeGuardSuiteSummary {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  allAcceptable: boolean;
  results: ScopeGuardEvaluationResult[];
}

/**
 * Runs a batch of candidate responses (keyed by case ID or supplied via a resolver)
 * against the Scope-Guard evaluation set.
 */
export function evaluateScopeGuardSuite(
  evaluationSet: ScopeGuardEvaluationSet,
  resolveResponse: (testCase: ScopeGuardCase) => string | undefined,
): ScopeGuardSuiteSummary {
  const results = evaluationSet.cases.map((testCase) => {
    const candidate = resolveResponse(testCase) ?? '';
    return evaluateScopeGuardResponse(testCase, candidate);
  });

  const passedCases = results.filter((result) => result.acceptable).length;

  return {
    totalCases: results.length,
    passedCases,
    failedCases: results.length - passedCases,
    allAcceptable: passedCases === results.length,
    results,
  };
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultFixturePath = join(currentDir, '..', 'fixtures', 'scope-guard', 'evaluation-set.json');

/**
 * Loads and validates the canonical Scope-Guard evaluation set fixture from disk.
 */
export function loadScopeGuardEvaluationSet(
  fixturePath: string = defaultFixturePath,
): ScopeGuardEvaluationSet {
  const raw = readFileSync(fixturePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return scopeGuardEvaluationSetSchema.parse(parsed);
}
