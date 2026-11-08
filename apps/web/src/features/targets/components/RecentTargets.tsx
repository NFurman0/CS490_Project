import { useEffect, useState } from 'react';
import { LoadingState } from '../../../components/ui/LoadingState';
import { ApiError } from '../../../lib/api-client';
import { useApi } from '../../../lib/api-context';
import { FALLBACK_MESSAGE } from '../../../lib/errors';
import { listRecentAnalysisTargets, type AnalysisTargetSummary } from '../api';

export function RecentTargets() {
  const client = useApi();
  const [targets, setTargets] = useState<AnalysisTargetSummary[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listRecentAnalysisTargets(client).then(
      (results) => {
        if (!cancelled) setTargets(results);
      },
      (error: unknown) => {
        if (!cancelled) {
          setErrorMessage(error instanceof ApiError ? error.message : FALLBACK_MESSAGE);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client]);

  return (
    <section className="recent-targets" aria-labelledby="recent-targets-heading">
      <h2 className="sidebar-section-heading" id="recent-targets-heading">
        Recent targets
      </h2>
      {targets === null && !errorMessage && <LoadingState label="Loading targets…" />}
      {errorMessage && (
        <p className="sidebar-message" role="alert">
          {errorMessage}
        </p>
      )}
      {targets?.length === 0 && !errorMessage && (
        <p className="sidebar-message">Your targets will appear here.</p>
      )}
      {targets && targets.length > 0 && (
        <ul className="recent-target-list">
          {targets.map((target) => (
            <li key={target.id}>{target.name}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
