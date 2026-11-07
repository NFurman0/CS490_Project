import { useAuth } from '@clerk/react';
import { useMemo } from 'react';
import { createApiClient, type ApiClient } from './api-client';

/** An API client that sends the signed-in user's Clerk session token. */
export function useApiClient(baseUrl: string): ApiClient {
  const { getToken } = useAuth();
  return useMemo(
    () => createApiClient({ baseUrl, getToken: () => getToken() }),
    [baseUrl, getToken],
  );
}
