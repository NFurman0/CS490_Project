import type { CreateAnalysisTargetInput } from '@reviewlens/shared';
import type { ApiClient } from '../../lib/api-client';

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

export function listRecentAnalysisTargets(client: ApiClient): Promise<AnalysisTargetSummary[]> {
  return client.get('/api/analysis-targets/recent');
}
