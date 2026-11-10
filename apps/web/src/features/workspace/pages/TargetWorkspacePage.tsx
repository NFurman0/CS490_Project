import { useEffect, useRef, useState } from 'react';
import type { IngestionRunResponse } from '@reviewlens/shared';
import { Link, useParams } from 'react-router';
import { LoadingState } from '../../../components/ui/LoadingState';
import { ApiError } from '../../../lib/api-client';
import { useApi } from '../../../lib/api-context';
import { FALLBACK_MESSAGE, ingestionMessageFor } from '../../../lib/errors';
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
  const navigationEpoch = useRef(0);

  // React may reuse this page for another target while its earlier requests are in flight.
  // Never render a previous target's details or errors while the new target loads.
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
          // The target itself loaded successfully; keep its workspace usable
          // without claiming a missing run means there have been no attempts.
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
      // Incrementing even when navigating away and back to the same target ID
      // invalidates responses from the previous visit, not just other targets.
      navigationEpoch.current += 1;
    };
  }, [client, targetId]);

  async function handleStartIngestion() {
    if (!targetId || isStarting) return;
    const requestedId = targetId;
    // Remember which saved run was visible before the POST. A 500 can occur
    // after a new run was persisted, so the refresh must distinguish new state
    // from the older run rather than treating every successful GET as new work.
    const previousRunId = currentWorkspace?.run?.id;
    const epoch = navigationEpoch.current;
    const isCurrent = () => navigationEpoch.current === epoch;
    setStartingTargetId(requestedId);
    setStartError(null);
    try {
      const run = await startIngestionRun(client, requestedId);
      if (isCurrent()) {
        setWorkspace((current) =>
          current?.targetId === requestedId ? { ...current, run, statusError: null } : current,
        );
      }
    } catch (error) {
      if (isCurrent()) {
        setStartError({ targetId: requestedId, message: errorMessage(error) });
        // The POST may have persisted a failure before returning 500. Hide any
        // older run until the owned latest-run read confirms what happened.
        setWorkspace((current) =>
          current?.targetId === requestedId
            ? { ...current, run: null, statusError: 'Checking the latest ingestion state…' }
            : current,
        );
        try {
          const run = await getLatestIngestionRun(client, requestedId);
          if (isCurrent()) {
            setWorkspace((current) =>
              current?.targetId === requestedId
                ? run?.id === previousRunId && previousRunId
                  ? {
                      ...current,
                      run: null,
                      // Same ID means the GET found only the older run; it cannot
                      // establish whether this POST created or completed a new one.
                      // Hide that old success as attempt feedback, not its saved reviews.
                      statusError:
                        'The latest saved run is from before this request. The outcome of this attempt could not be confirmed. Try again.',
                    }
                  : { ...current, run, statusError: null }
                : current,
            );
          }
        } catch {
          if (isCurrent()) {
            setWorkspace((current) =>
              current?.targetId === requestedId
                ? {
                    ...current,
                    run: null,
                    statusError: 'Could not confirm the latest ingestion state. Try again.',
                  }
                : current,
            );
          }
        }
      }
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
                  {/* The count is inserted rows for this run, not raw source records or a lifetime total. */}
                  {currentWorkspace.run?.status === 'succeeded' && (
                    <p>{currentWorkspace.run.reviewCount} reviews saved in this run.</p>
                  )}
                  {/* A later-page error warns about collection, but does not undo saved reviews. */}
                  {currentWorkspace.run?.status === 'succeeded' &&
                    currentWorkspace.run.errorCode && (
                      <p className="form-error-summary" role="alert">
                        Collection stopped early.{' '}
                        {ingestionMessageFor(currentWorkspace.run.errorCode)}
                      </p>
                    )}
                  {currentWorkspace.run?.status === 'failed' && (
                    <p className="form-error-summary" role="alert">
                      {ingestionMessageFor(currentWorkspace.run.errorCode)}
                    </p>
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
