import { useEffect, useState } from 'react';
import { LoadingState } from '../../../components/ui/LoadingState';
import { ApiError } from '../../../lib/api-client';
import { useApi } from '../../../lib/api-context';
import { FALLBACK_MESSAGE } from '../../../lib/errors';
import { listAnalysisTargets, type AnalysisTargetSummary } from '../../targets/api';

export function WorkspaceHomePage() {
  const client = useApi();
  const [targets, setTargets] = useState<AnalysisTargetSummary[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAnalysisTargets(client).then(
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
    <section className="target-list-page">
      <h1>Analysis targets</h1>
      {targets === null && !errorMessage && <LoadingState label="Loading your targets…" />}
      {errorMessage && (
        <p className="form-error-summary" role="alert">
          {errorMessage}
        </p>
      )}
      {targets?.length === 0 && !errorMessage && (
        <p className="target-list-empty">You haven’t created any targets yet.</p>
      )}
      {targets && targets.length > 0 && (
        <ul className="target-list">
          {targets.map((target) => (
            <li className="target-list-item" key={target.id}>
              <h2>{target.name}</h2>
              <p>
                <strong>Review platform:</strong> Google Maps
              </p>
              <p>
                <strong>Source URL:</strong>{' '}
                <a href={target.sourceUrl} rel="noopener noreferrer" target="_blank">
                  {target.sourceUrl}
                </a>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
