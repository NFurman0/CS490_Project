import { useEffect, useState } from 'react';
import { ApiError, type ApiClient } from '../../../lib/api-client';
import { FALLBACK_MESSAGE } from '../../../lib/errors';
import { fetchSession } from '../api';

type Status = { kind: 'checking' } | { kind: 'verified' } | { kind: 'failed'; message: string };

/** Confirms the signed-in session works end to end, from browser to API. */
export function SessionStatus({ client }: { client: ApiClient }) {
  const [status, setStatus] = useState<Status>({ kind: 'checking' });

  useEffect(() => {
    let cancelled = false;
    fetchSession(client).then(
      () => {
        if (!cancelled) setStatus({ kind: 'verified' });
      },
      (error: unknown) => {
        if (cancelled) return;
        const message = error instanceof ApiError ? error.message : FALLBACK_MESSAGE;
        setStatus({ kind: 'failed', message });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (status.kind === 'checking') {
    return <p role="status">Connecting to ReviewLens…</p>;
  }
  if (status.kind === 'failed') {
    return (
      <p role="alert" className="status-error">
        {status.message}
      </p>
    );
  }
  return (
    <p role="status" className="status-success">
      You’re signed in and connected to ReviewLens.
    </p>
  );
}
