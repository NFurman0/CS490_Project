import type { CreateAnalysisTargetInput } from '@reviewlens/shared';
import type { ApiClient } from '../../lib/api-client';

export const ANALYSIS_TARGETS_CHANGED_EVENT = 'reviewlens:analysis-targets-changed';

export interface AnalysisTargetSummary {
  id: string;
  name: string;
  platform: 'google_maps';
  sourceUrl: string;
  createdAt: string;
}

export type CreatedAnalysisTarget = AnalysisTargetSummary;

export function createAnalysisTarget(
  client: ApiClient,
  input: CreateAnalysisTargetInput,
): Promise<AnalysisTargetSummary> {
  return client.post('/api/analysis-targets', input);
}

export function listAnalysisTargets(client: ApiClient): Promise<AnalysisTargetSummary[]> {
  return client.get('/api/analysis-targets');
}

export function getAnalysisTarget(
  client: ApiClient,
  targetId: string,
): Promise<AnalysisTargetSummary> {
  return client.get(`/api/analysis-targets/${encodeURIComponent(targetId)}`);
}

export function listRecentAnalysisTargets(client: ApiClient): Promise<AnalysisTargetSummary[]> {
  return client.get('/api/analysis-targets/recent');
}
