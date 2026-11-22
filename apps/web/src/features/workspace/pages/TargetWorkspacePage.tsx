import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { IngestionRunResponse } from '@reviewlens/shared';
import { Link, useLocation, useParams } from 'react-router';
import { LoadingState } from '../../../components/ui/LoadingState';
import { ApiError } from '../../../lib/api-client';
import { useApi } from '../../../lib/api-context';
import { FALLBACK_MESSAGE, ingestionMessageFor } from '../../../lib/errors';
import { getLatestIngestionRun, startIngestionRun } from '../../ingestion/api';
import { askQuestion, type QaAnswer } from '../../qa/api';
import { getAnalysisTarget, type AnalysisTargetSummary } from '../../targets/api';
import { ActiveTargetHeader } from '../../targets/components/ActiveTargetHeader';

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

interface QuestionDraft {
  visitId: string;
  value: string;
  touched: boolean;
}

interface QaPageError {
  visitId: string;
  message: string;
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : FALLBACK_MESSAGE;
}

function qaOutcomeLabel(outcome: QaAnswer['outcome']): string {
  switch (outcome) {
    case 'grounded_answer':
      return 'Answer from your reviews';
    case 'insufficient_evidence':
      return 'Not enough review evidence';
    case 'out_of_scope_refusal':
      return 'Outside the review-analysis scope';
    case 'no_review_data':
      return 'No reviews available';
  }
}

function statusLabel(run: IngestionRunResponse | null): string {
  if (!run) return 'No ingestion attempt yet';
  if (run.status === 'running') return 'In progress';
  if (run.status === 'succeeded') return run.errorCode ? 'Partially succeeded' : 'Succeeded';
  return 'Failed';
}

export function TargetWorkspacePage() {
  const { targetId } = useParams();
  const { key: locationKey } = useLocation();
  const client = useApi();
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [loadError, setLoadError] = useState<PageError | null>(null);
  const [startingTargetId, setStartingTargetId] = useState<string | null>(null);
  const [startError, setStartError] = useState<PageError | null>(null);
  const [questionDraft, setQuestionDraft] = useState<QuestionDraft | null>(null);
  const [askingVisitId, setAskingVisitId] = useState<string | null>(null);
  const [qaAnswer, setQaAnswer] = useState<{ visitId: string; answer: QaAnswer } | null>(null);
  const [qaError, setQaError] = useState<QaPageError | null>(null);
  const navigationEpoch = useRef(0);
  const qaVisitId = `${locationKey}:${targetId ?? ''}`;

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
  const currentQuestion =
    questionDraft && questionDraft.visitId === qaVisitId
      ? questionDraft
      : { visitId: qaVisitId, value: '', touched: false };
  const questionError =
    currentQuestion.touched && !currentQuestion.value.trim()
      ? 'Enter a question about this target’s reviews.'
      : null;
  const isAsking = askingVisitId === qaVisitId;
  const currentQaAnswer = qaAnswer && qaAnswer.visitId === qaVisitId ? qaAnswer.answer : null;
  const currentQaError = qaError && qaError.visitId === qaVisitId ? qaError.message : null;

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

  async function handleAskQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!targetId || isAsking) return;

    const question = currentQuestion.value.trim();
    setQuestionDraft({ ...currentQuestion, visitId: qaVisitId, touched: true });
    if (!question) return;

    const requestedId = targetId;
    const epoch = navigationEpoch.current;
    const isCurrent = () => navigationEpoch.current === epoch;
    setAskingVisitId(qaVisitId);
    setQaAnswer(null);
    setQaError(null);
    try {
      const answer = await askQuestion(client, requestedId, question);
      if (isCurrent()) setQaAnswer({ visitId: qaVisitId, answer });
    } catch (error) {
      if (isCurrent()) setQaError({ visitId: qaVisitId, message: errorMessage(error) });
    } finally {
      if (isCurrent()) {
        setAskingVisitId((current) => (current === qaVisitId ? null : current));
      }
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
          <ActiveTargetHeader
            surface="Analysis target workspace"
            target={currentWorkspace.target}
          />
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
              <p className="workspace-panel-target">
                Reviews for <strong>{currentWorkspace.target.name}</strong>
              </p>
              {currentWorkspace.statusError ? (
                <p className="form-error-summary" role="alert">
                  {currentWorkspace.statusError}
                </p>
              ) : (
                <>
                  <p>
                    <strong>Latest ingestion attempt:</strong> {statusLabel(currentWorkspace.run)}
                  </p>
                  {/* The count is inserted rows for this run, not raw source records or a lifetime total. */}
                  {currentWorkspace.run?.status === 'succeeded' && (
                    <p>{`${currentWorkspace.run.reviewCount} reviews saved in this run.`}</p>
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
            <section className="workspace-panel workspace-qa" aria-label="Review Q&A">
              <h2>Ask about your reviews</h2>
              <p>
                Ask a question about <strong>{currentWorkspace.target.name}</strong>. ReviewLens
                answers using this target’s ingested reviews.
              </p>
              <form className="qa-form" onSubmit={(event) => void handleAskQuestion(event)}>
                <div className="form-field">
                  <label htmlFor="qa-question">Your question</label>
                  <textarea
                    aria-describedby={questionError ? 'qa-question-error' : undefined}
                    aria-invalid={questionError ? 'true' : undefined}
                    className="form-input qa-question"
                    id="qa-question"
                    onChange={(event) =>
                      setQuestionDraft({
                        visitId: qaVisitId,
                        value: event.currentTarget.value,
                        touched: true,
                      })
                    }
                    rows={4}
                    value={currentQuestion.value}
                    disabled={isAsking}
                  />
                  {questionError && (
                    <p className="field-error" id="qa-question-error" role="alert">
                      {questionError}
                    </p>
                  )}
                </div>
                <button
                  className="button button-primary"
                  disabled={!currentQuestion.value.trim() || isAsking}
                  type="submit"
                >
                  {isAsking ? 'Asking…' : 'Ask question'}
                </button>
              </form>
              {isAsking && <LoadingState label="ReviewLens is analyzing your question…" />}
              {currentQaError && (
                <p className="form-error-summary" role="alert">
                  {currentQaError}
                </p>
              )}
              {currentQaAnswer && (
                <section
                  aria-label="ReviewLens response"
                  className="qa-response"
                  aria-live="polite"
                >
                  <h3>{qaOutcomeLabel(currentQaAnswer.outcome)}</h3>
                  <p className="qa-answer">{currentQaAnswer.answer}</p>
                  {currentQaAnswer.context.truncated && (
                    <p className="field-hint">
                      Based on {currentQaAnswer.context.reviewsUsed} of{' '}
                      {currentQaAnswer.reviewCount} reviews.
                    </p>
                  )}
                </section>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}
