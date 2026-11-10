import type { IngestionRunResponse } from '@reviewlens/shared';
import type { ApiClient } from '../../lib/api-client';

function runsPath(targetId: string): string {
  return `/api/analysis-targets/${encodeURIComponent(targetId)}/ingestion-runs`;
}

export function getLatestIngestionRun(
  client: ApiClient,
  targetId: string,
): Promise<IngestionRunResponse | null> {
  return client.get(`${runsPath(targetId)}/latest`);
}

export function startIngestionRun(
  client: ApiClient,
  targetId: string,
): Promise<IngestionRunResponse> {
  return client.post(runsPath(targetId), {});
}
