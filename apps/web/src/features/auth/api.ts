import type { ApiClient } from '../../lib/api-client';

export interface SessionInfo {
  authenticated: boolean;
}

/** Confirms the API accepts the current session (GET /api/session). */
export function fetchSession(client: ApiClient): Promise<SessionInfo> {
  return client.get<SessionInfo>('/api/session');
}
