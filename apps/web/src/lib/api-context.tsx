import { createContext, useContext, type ReactNode } from 'react';
import type { ApiClient } from './api-client';
import { useApiClient } from './use-api-client';

const ApiClientContext = createContext<ApiClient | null>(null);

/** Makes the authenticated API client available to every page. */
export function ApiClientProvider({ baseUrl, children }: { baseUrl: string; children: ReactNode }) {
  const client = useApiClient(baseUrl);
  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>;
}

/** The API client for the signed-in user. Must be used inside ApiClientProvider. */
export function useApi(): ApiClient {
  const client = useContext(ApiClientContext);
  if (!client) throw new Error('useApi must be used inside ApiClientProvider');
  return client;
}
