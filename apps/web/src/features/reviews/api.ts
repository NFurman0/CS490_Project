import type { ReviewSummary } from '@reviewlens/shared';
import type { ApiClient } from '../../lib/api-client';

export function getReviewSummary(client: ApiClient, targetId: string): Promise<ReviewSummary> {
  return client.get(`/api/analysis-targets/${encodeURIComponent(targetId)}/reviews/summary`);
}
