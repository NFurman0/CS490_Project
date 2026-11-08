import type { CreateAnalysisTargetInput } from '@reviewlens/shared';
import type { ApiClient } from '../../lib/api-client';

export interface CreatedAnalysisTarget {
  id: string;
  name: string;
  platform: 'google_maps';
  sourceUrl: string;
  createdAt: string;
}

export function createAnalysisTarget(
  client: ApiClient,
  input: CreateAnalysisTargetInput,
): Promise<CreatedAnalysisTarget> {
  return client.post('/api/analysis-targets', input);
}
