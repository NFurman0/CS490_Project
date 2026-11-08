import { useEffect, useState } from 'react';
import { LoadingState } from '../../../components/ui/LoadingState';
import { ApiError } from '../../../lib/api-client';
import { useApi } from '../../../lib/api-context';
import { FALLBACK_MESSAGE } from '../../../lib/errors';
import {
  ANALYSIS_TARGETS_CHANGED_EVENT,
  listRecentAnalysisTargets,
  type AnalysisTargetSummary,
} from '../api';

export function RecentTargets() {
  const client = useApi();
  const [targets, setTargets] = useState<AnalysisTargetSummary[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let requestId = 0;
    const loadTargets = () => {
      const currentRequestId = ++requestId;
      setErrorMessage(null);
      listRecentAnalysisTargets(client).then(
        (results) => {
          if (!cancelled && currentRequestId === requestId) setTargets(results);
        },
        (error: unknown) => {
          if (cancelled || currentRequestId !== requestId) return;
          setErrorMessage(error instanceof ApiError ? error.message : FALLBACK_MESSAGE);
        },
      );
    };

    loadTargets();
    window.addEventListener(ANALYSIS_TARGETS_CHANGED_EVENT, loadTargets);
    return () => {
      cancelled = true;
      window.removeEventListener(ANALYSIS_TARGETS_CHANGED_EVENT, loadTargets);
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
