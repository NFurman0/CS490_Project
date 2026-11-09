import { useEffect, useState } from 'react';
import type { IngestionRunResponse } from '@reviewlens/shared';
import { Link, useParams } from 'react-router';
import { LoadingState } from '../../../components/ui/LoadingState';
import { ApiError } from '../../../lib/api-client';
import { useApi } from '../../../lib/api-context';
import { FALLBACK_MESSAGE } from '../../../lib/errors';
import { getLatestIngestionRun, startIngestionRun } from '../../ingestion/api';
import { getAnalysisTarget, type AnalysisTargetSummary } from '../../targets/api';

interface WorkspaceData {
  targetId: string;
  target: AnalysisTargetSummary;
  run: IngestionRunResponse | null;
  statusError: string | null;
}

interface PageError {
  targetId: string;
  message: string;
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : FALLBACK_MESSAGE;
}

function statusLabel(run: IngestionRunResponse | null): string {
  if (!run) return 'No ingestion attempt yet';
  if (run.status === 'running') return 'In progress';
  if (run.status === 'succeeded') return 'Succeeded';
  return 'Failed';
}

export function TargetWorkspacePage() {
  const { targetId } = useParams();
  const client = useApi();
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [loadError, setLoadError] = useState<PageError | null>(null);
  const [startingTargetId, setStartingTargetId] = useState<string | null>(null);
  const [startError, setStartError] = useState<PageError | null>(null);

  const currentWorkspace = workspace?.targetId === targetId ? workspace : null;
  const currentLoadError = !targetId
    ? 'Analysis target not found.'
    : loadError?.targetId === targetId
      ? loadError.message
      : null;
  const isLoading = !currentWorkspace && !currentLoadError;
  const isStarting = startingTargetId === targetId;

  useEffect(() => {
    if (!targetId) return;
    const requestedId = targetId;
    let active = true;

    async function loadWorkspace() {
      try {
        const target = await getAnalysisTarget(client, requestedId);
        let run: IngestionRunResponse | null = null;
        let statusError: string | null = null;
        try {
          run = await getLatestIngestionRun(client, requestedId);
        } catch {
          statusError = 'Could not load the current ingestion state. Try again.';
        }
        if (active) setWorkspace({ targetId: requestedId, target, run, statusError });
      } catch (error) {
        if (active) {
          setLoadError({
            targetId: requestedId,
            message:
              error instanceof ApiError && error.status === 404
                ? 'Analysis target not found.'
                : errorMessage(error),
          });
        }
      }
    }

    void loadWorkspace();
    return () => {
      active = false;
    };
  }, [client, targetId]);

  async function handleStartIngestion() {
    if (!targetId || isStarting) return;
    const requestedId = targetId;
    setStartingTargetId(requestedId);
    setStartError(null);
    try {
      const run = await startIngestionRun(client, requestedId);
      setWorkspace((current) =>
        current?.targetId === requestedId ? { ...current, run, statusError: null } : current,
      );
    } catch (error) {
      setStartError({ targetId: requestedId, message: errorMessage(error) });
    } finally {
      setStartingTargetId((current) => (current === requestedId ? null : current));
    }
  }

  return (
    <section className="target-workspace-page">
      <Link className="workspace-back-link" to="/analysis-targets">
        ← All analysis targets
      </Link>
      {isLoading && <LoadingState label="Loading target workspace…" />}
      {currentLoadError && (
        <p className="form-error-summary" role="alert">
          {currentLoadError}
        </p>
      )}
      {currentWorkspace && (
        <>
          <header className="page-heading">
            <p className="eyebrow">ANALYSIS TARGET WORKSPACE</p>
            <h1>{currentWorkspace.target.name}</h1>
          </header>
          <div className="workspace-grid">
            <section className="workspace-panel" aria-label="Target details">
              <h2>Target details</h2>
              <dl className="workspace-details">
                <div>
                  <dt>Review platform</dt>
                  <dd>Google Maps</dd>
                </div>
                <div>
                  <dt>Source reference</dt>
                  <dd>
                    <a
                      href={currentWorkspace.target.sourceUrl}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {currentWorkspace.target.sourceUrl}
                    </a>
                  </dd>
                </div>
              </dl>
            </section>
            <section className="workspace-panel" aria-label="Review ingestion">
              <h2>Review ingestion</h2>
              {currentWorkspace.statusError ? (
                <p className="form-error-summary" role="alert">
                  {currentWorkspace.statusError}
                </p>
              ) : (
                <>
                  <p>
                    <strong>Current state:</strong> {statusLabel(currentWorkspace.run)}
                  </p>
                  {currentWorkspace.run?.status === 'succeeded' && (
                    <p>Reviews returned from the source: {currentWorkspace.run.reviewCount}</p>
                  )}
                  {currentWorkspace.run?.status === 'failed' && (
                    <p>Review collection did not finish. You can try again.</p>
                  )}
                </>
              )}
              {startError && startError.targetId === targetId && (
                <p className="form-error-summary" role="alert">
                  {startError.message}
                </p>
              )}
              <button
                className="button"
                disabled={isStarting}
                onClick={() => void handleStartIngestion()}
                type="button"
              >
                {isStarting ? 'Starting ingestion…' : 'Start ingestion'}
              </button>
            </section>
          </div>
        </>
      )}
    </section>
  );
}
