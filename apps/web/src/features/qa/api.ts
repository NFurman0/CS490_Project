import type { ApiClient } from '../../lib/api-client';

export type QaOutcome =
  'grounded_answer' | 'insufficient_evidence' | 'out_of_scope_refusal' | 'no_review_data';

export interface QaAnswer {
  target: { id: string; name: string; platform: string };
  outcome: QaOutcome;
  answer: string;
  reviewCount: number;
  context: { reviewsUsed: number; truncated: boolean };
}

export function askQuestion(
  client: Pick<ApiClient, 'post'>,
  targetId: string,
  question: string,
): Promise<QaAnswer> {
  return client.post(`/api/analysis-targets/${encodeURIComponent(targetId)}/qa`, { question });
}
