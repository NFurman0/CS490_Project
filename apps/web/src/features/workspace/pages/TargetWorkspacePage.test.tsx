import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api-client';
import { TargetWorkspacePage } from './TargetWorkspacePage';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const reviewSummary = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../../lib/api-context', () => ({
  useApi: () => api,
}));
vi.mock('../../reviews/api', () => ({ getReviewSummary: reviewSummary.get }));

const target = {
  id: 'target-1',
  name: 'My coffee shop',
  platform: 'google_maps' as const,
  sourceUrl: 'https://maps.google.com/?cid=123',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const succeededRun = {
  id: 'run-1',
  targetId: target.id,
  status: 'succeeded' as const,
  errorCode: null,
  reviewCount: 12,
  startedAt: '2026-01-02T00:00:00.000Z',
  completedAt: '2026-01-02T00:01:00.000Z',
};

function renderPage(targetId = target.id) {
  return render(
    <MemoryRouter initialEntries={[`/analysis-targets/${targetId}`]}>
      <Routes>
        <Route
          path="analysis-targets/:targetId"
          element={
            <>
              <Link to="/analysis-targets/target-2">Other target</Link>
              <TargetWorkspacePage />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('TargetWorkspacePage', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    reviewSummary.get.mockReset();
    reviewSummary.get.mockResolvedValue({
      target: { id: target.id, name: target.name, platform: 'google_maps' },
      reviewCount: 12,
      averageRating: 4.25,
    });
  });

  it('shows the exact saved count and rating independently of the latest run', async () => {
    api.get.mockResolvedValueOnce(target).mockResolvedValueOnce({
      ...succeededRun,
      status: 'failed',
      reviewCount: 0,
      errorCode: 'PROVIDER_ERROR',
    });
    renderPage();

    const summary = await screen.findByRole('region', { name: 'Saved review summary' });
    expect(summary).toHaveTextContent('Reviews in active dataset12');
    expect(summary).toHaveTextContent('Average rating4.3 out of 5');
    expect(reviewSummary.get).toHaveBeenCalledWith(api, target.id);
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('shows zero and no rating for an empty saved dataset', async () => {
    reviewSummary.get.mockResolvedValueOnce({
      target: { id: target.id, name: target.name, platform: 'google_maps' },
      reviewCount: 0,
      averageRating: null,
    });
    api.get.mockResolvedValueOnce(target).mockResolvedValueOnce(null);
    renderPage();

    const summary = await screen.findByRole('region', { name: 'Saved review summary' });
    expect(summary).toHaveTextContent('Reviews in active dataset0');
    expect(summary).toHaveTextContent('No rating yet');
  });

  it('refreshes the saved summary after ingestion succeeds', async () => {
    reviewSummary.get
      .mockResolvedValueOnce({
        target: { id: target.id, name: target.name, platform: 'google_maps' },
        reviewCount: 0,
        averageRating: null,
      })
      .mockResolvedValueOnce({
        target: { id: target.id, name: target.name, platform: 'google_maps' },
        reviewCount: 2,
        averageRating: 3.5,
      });
    api.get.mockResolvedValueOnce(target).mockResolvedValueOnce(null);
    api.post.mockResolvedValueOnce(succeededRun);
    renderPage();

    await screen.findByText('No rating yet');
    fireEvent.click(screen.getByRole('button', { name: 'Start ingestion' }));
    expect(await screen.findByText('3.5 out of 5')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('12 reviews saved in this run.')).toBeInTheDocument();
    expect(reviewSummary.get).toHaveBeenCalledTimes(2);
  });

  it('does not present a saved-review count when its request fails', async () => {
    reviewSummary.get.mockRejectedValueOnce(new ApiError(503, 'Internal error'));
    api.get.mockResolvedValueOnce(target).mockResolvedValueOnce(null);
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load the saved review summary. Try again.',
    );
    expect(screen.queryByText('12')).not.toBeInTheDocument();
    expect(screen.queryByText('Internal error')).not.toBeInTheDocument();
  });

  it('reloads saved reviews even when an ingestion request reports failure', async () => {
    reviewSummary.get
      .mockResolvedValueOnce({
        target: { id: target.id, name: target.name, platform: 'google_maps' },
        reviewCount: 1,
        averageRating: 5,
      })
      .mockResolvedValueOnce({
        target: { id: target.id, name: target.name, platform: 'google_maps' },
        reviewCount: 2,
        averageRating: 3,
      });
    api.get.mockResolvedValueOnce(target).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    api.post.mockRejectedValueOnce(new ApiError(500, 'Something went wrong on our side.'));
    renderPage();

    await screen.findByText('5.0 out of 5');
    fireEvent.click(screen.getByRole('button', { name: 'Start ingestion' }));
    expect(screen.queryByText('5.0 out of 5')).not.toBeInTheDocument();
    expect(await screen.findByText('3.0 out of 5')).toBeInTheDocument();
    expect(reviewSummary.get).toHaveBeenCalledTimes(2);
  });

  it('shows the active target and its latest ingestion state', async () => {
    api.get.mockResolvedValueOnce(target).mockResolvedValueOnce(succeededRun);

    renderPage();

    expect(await screen.findByRole('heading', { name: target.name })).toBeInTheDocument();
    expect(screen.getByText('Google Maps')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: target.sourceUrl })).toHaveAttribute(
      'href',
      target.sourceUrl,
    );
    expect(await screen.findByText('12 reviews saved in this run.')).toBeInTheDocument();
    expect(screen.getByText('Latest ingestion attempt:')).toBeInTheDocument();
    expect(screen.getByText('Succeeded')).toBeInTheDocument();
    expect(api.get).toHaveBeenNthCalledWith(1, '/api/analysis-targets/target-1');
    expect(api.get).toHaveBeenNthCalledWith(
      2,
      '/api/analysis-targets/target-1/ingestion-runs/latest',
    );
  });

  it('shows a per-run saved count for a completed ingestion', async () => {
    api.get.mockResolvedValueOnce(target).mockResolvedValueOnce(null);
    api.post.mockResolvedValueOnce(succeededRun);

    renderPage();
    await screen.findByText('No ingestion attempt yet');
    fireEvent.click(screen.getByRole('button', { name: 'Start ingestion' }));

    expect(await screen.findByText('12 reviews saved in this run.')).toBeInTheDocument();
    expect(screen.getByText('Succeeded')).toBeInTheDocument();
  });

  it('shows a persisted running ingestion as in progress', async () => {
    api.get.mockResolvedValueOnce(target).mockResolvedValueOnce({
      ...succeededRun,
      status: 'running',
      reviewCount: 0,
      completedAt: null,
    });

    renderPage();

    expect(await screen.findByText('In progress')).toBeInTheDocument();
    expect(screen.queryByText(/reviews saved in this run/)).not.toBeInTheDocument();
  });

  it.each([
    ['SOURCE_UNRESOLVABLE', 'The Google Maps place link could not be resolved.'],
    ['SOURCE_NO_REVIEWS', 'No usable reviews were found'],
    ['PROVIDER_TIMEOUT', 'The review source timed out.'],
    ['PROVIDER_QUOTA_EXHAUSTED', 'The review service’s search limit was reached.'],
    ['PROVIDER_ERROR', 'The review service could not provide results.'],
    ['PERSISTENCE_ERROR', 'The reviews could not be saved.'],
  ])('reports a failed %s run safely after HTTP 201', async (code, cause) => {
    api.get.mockResolvedValueOnce(target).mockResolvedValueOnce(null);
    api.post.mockResolvedValueOnce({
      ...succeededRun,
      status: 'failed',
      errorCode: code,
      reviewCount: 0,
    });

    renderPage();

    expect(await screen.findByText(/No ingestion attempt yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start ingestion' }));

    expect(api.post).toHaveBeenCalledWith('/api/analysis-targets/target-1/ingestion-runs', {});
    expect(await screen.findByRole('alert')).toHaveTextContent(cause);
    expect(screen.getByRole('alert')).toHaveTextContent(/try again/i);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.queryByText(/reviews saved in this run/)).not.toBeInTheDocument();
  });

  it('marks a saved run as partially succeeded when collection stopped early', async () => {
    api.get.mockResolvedValueOnce(target).mockResolvedValueOnce({
      ...succeededRun,
      errorCode: 'PROVIDER_TIMEOUT',
    });

    renderPage();

    expect(await screen.findByText('12 reviews saved in this run.')).toBeInTheDocument();
    expect(screen.getByText('Partially succeeded')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Collection stopped early. The review source timed out.',
    );
  });

  it('does not request ingestion data or show target details when access is denied', async () => {
    api.get.mockRejectedValueOnce(new ApiError(404, 'Analysis target not found.', 'NOT_FOUND'));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Analysis target not found.');
    expect(screen.queryByRole('heading', { name: target.name })).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('keeps the workspace usable when the ingestion state cannot be loaded', async () => {
    api.get.mockResolvedValueOnce(target).mockRejectedValueOnce(new ApiError(500, 'Try again.'));

    renderPage();

    expect(await screen.findByRole('heading', { name: target.name })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load the current ingestion state. Try again.',
    );
    expect(screen.getByRole('button', { name: 'Start ingestion' })).toBeEnabled();
  });

  it('refreshes a persisted failed run after POST 500 instead of presenting an earlier success', async () => {
    api.get
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(succeededRun)
      .mockResolvedValueOnce({
        ...succeededRun,
        id: 'run-2',
        status: 'failed',
        errorCode: 'PERSISTENCE_ERROR',
        reviewCount: 0,
      });
    api.post.mockRejectedValueOnce(new ApiError(500, 'Something went wrong on our side.'));

    renderPage();
    await screen.findByText('12 reviews saved in this run.');
    fireEvent.click(screen.getByRole('button', { name: 'Start ingestion' }));

    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(
      screen.getByText('The reviews could not be saved. Please try again later.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Something went wrong on our side.')).toBeInTheDocument();
    expect(screen.queryByText('12 reviews saved in this run.')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenNthCalledWith(
      3,
      '/api/analysis-targets/target-1/ingestion-runs/latest',
    );
  });

  it('does not claim an old success if the refresh after POST failure also fails', async () => {
    api.get
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(succeededRun)
      .mockRejectedValueOnce(new ApiError(500, 'Internal database details'));
    api.post.mockRejectedValueOnce(new ApiError(500, 'Something went wrong on our side.'));

    renderPage();
    await screen.findByText('12 reviews saved in this run.');
    fireEvent.click(screen.getByRole('button', { name: 'Start ingestion' }));

    expect(
      await screen.findByText('Could not confirm the latest ingestion state. Try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('12 reviews saved in this run.')).not.toBeInTheDocument();
    expect(screen.queryByText('Internal database details')).not.toBeInTheDocument();
    expect(screen.getByText('Something went wrong on our side.')).toBeInTheDocument();
  });

  it('does not treat the same older successful run as the outcome of a failed POST', async () => {
    api.get
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(succeededRun)
      .mockResolvedValueOnce(succeededRun);
    api.post.mockRejectedValueOnce(new ApiError(500, 'Something went wrong on our side.'));

    renderPage();
    await screen.findByText('12 reviews saved in this run.');
    fireEvent.click(screen.getByRole('button', { name: 'Start ingestion' }));

    expect(
      await screen.findByText(
        'The latest saved run is from before this request. The outcome of this attempt could not be confirmed. Try again.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('12 reviews saved in this run.')).not.toBeInTheDocument();
    expect(screen.queryByText('Succeeded')).not.toBeInTheDocument();
    expect(screen.getByText('Something went wrong on our side.')).toBeInTheDocument();
  });

  it('ignores an old target’s refresh when navigation changes during a rejected POST', async () => {
    let finishRefresh!: (value: typeof succeededRun) => void;
    api.get
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(succeededRun)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRefresh = resolve;
          }),
      )
      .mockResolvedValueOnce({ ...target, id: 'target-2', name: 'Second target' })
      .mockResolvedValueOnce(null);
    api.post.mockRejectedValueOnce(new ApiError(500, 'Something went wrong on our side.'));

    renderPage();
    await screen.findByText('12 reviews saved in this run.');
    fireEvent.click(screen.getByRole('button', { name: 'Start ingestion' }));
    await screen.findByText('Checking the latest ingestion state…');
    fireEvent.click(screen.getByRole('link', { name: 'Other target' }));

    expect(await screen.findByRole('heading', { name: 'Second target' })).toBeInTheDocument();
    finishRefresh(succeededRun);
    await waitFor(() => expect(screen.getByText('No ingestion attempt yet')).toBeInTheDocument());
    expect(screen.queryByText('12 reviews saved in this run.')).not.toBeInTheDocument();
    expect(screen.queryByText('Something went wrong on our side.')).not.toBeInTheDocument();
  });

  describe('switching the active target (S2-017)', () => {
    const secondTarget = {
      ...target,
      id: 'target-2',
      name: 'Second target',
      sourceUrl: 'https://maps.google.com/?cid=456',
    };

    it('labels the loaded target as the active target', async () => {
      api.get.mockResolvedValueOnce(target).mockResolvedValueOnce(succeededRun);

      renderPage();

      const heading = await screen.findByRole('heading', { level: 1, name: target.name });
      const header = heading.closest('header');
      expect(header).not.toBeNull();
      expect(within(header!).getByText('Active target · Google Maps reviews')).toBeInTheDocument();
    });

    it('names the target in the ingestion panel above its saved count', async () => {
      api.get.mockResolvedValueOnce(target).mockResolvedValueOnce(succeededRun);

      renderPage();

      const ingestion = await screen.findByRole('region', { name: 'Review ingestion' });
      expect(ingestion).toHaveTextContent(`Reviews for ${target.name}`);
      expect(
        await within(ingestion).findByText('12 reviews saved in this run.'),
      ).toBeInTheDocument();
    });

    it('says whose dataset it is before the first ingestion', async () => {
      api.get.mockResolvedValueOnce(target).mockResolvedValueOnce(null);

      renderPage();

      const ingestion = await screen.findByRole('region', { name: 'Review ingestion' });
      expect(ingestion).toHaveTextContent(`Reviews for ${target.name}`);
      expect(await within(ingestion).findByText('No ingestion attempt yet')).toBeInTheDocument();
    });

    it('says whose dataset it is when the ingestion state cannot be loaded', async () => {
      api.get.mockResolvedValueOnce(target).mockRejectedValueOnce(new ApiError(500, 'Try again.'));

      renderPage();

      const ingestion = await screen.findByRole('region', { name: 'Review ingestion' });
      expect(ingestion).toHaveTextContent(`Reviews for ${target.name}`);
      expect(within(ingestion).getByRole('alert')).toHaveTextContent(
        'Could not load the current ingestion state. Try again.',
      );
    });

    async function askAbout(question: string) {
      fireEvent.change(await screen.findByRole('textbox', { name: 'Your question' }), {
        target: { value: question },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Ask question' }));
    }

    it('labels a Q&A answer with the target it was answered from', async () => {
      api.get.mockResolvedValueOnce(target).mockResolvedValueOnce(null);
      api.post.mockResolvedValueOnce({
        target: { id: target.id, name: target.name, platform: 'google_maps' },
        outcome: 'grounded_answer',
        answer: 'Customers praise the espresso.',
        reviewCount: 12,
        context: { reviewsUsed: 12, truncated: false },
      });

      renderPage();
      await askAbout('What do customers like?');

      const response = await screen.findByRole('region', { name: 'ReviewLens response' });
      expect(
        within(response).getByRole('heading', { name: `Answer from ${target.name}’s reviews` }),
      ).toBeInTheDocument();
      expect(within(response).getByText('Customers praise the espresso.')).toBeInTheDocument();
    });

    it('does not show an answer that belongs to a different target', async () => {
      api.get.mockResolvedValueOnce(target).mockResolvedValueOnce(null);
      api.post.mockResolvedValueOnce({
        target: { id: 'someone-elses-target', name: 'Unrelated place', platform: 'google_maps' },
        outcome: 'grounded_answer',
        answer: 'Answer drawn from another dataset.',
        reviewCount: 3,
        context: { reviewsUsed: 3, truncated: false },
      });

      renderPage();
      await askAbout('What do customers like?');

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'ReviewLens couldn’t confirm this answer is for this target. Please try again.',
      );
      expect(screen.queryByRole('region', { name: 'ReviewLens response' })).not.toBeInTheDocument();
      expect(screen.queryByText('Answer drawn from another dataset.')).not.toBeInTheDocument();
      expect(screen.queryByText(/Unrelated place/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Ask question' })).toBeEnabled();
    });

    it('replaces every detail of the previous target after switching', async () => {
      let finishSecondTarget!: (value: typeof secondTarget) => void;
      api.get
        .mockResolvedValueOnce(target)
        .mockResolvedValueOnce(succeededRun)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishSecondTarget = resolve;
            }),
        )
        .mockResolvedValueOnce(null);

      renderPage();
      await screen.findByText('12 reviews saved in this run.');
      fireEvent.click(screen.getByRole('link', { name: 'Other target' }));

      // While Target B loads, nothing from Target A is presented as active.
      expect(screen.getByText('Loading target workspace…')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: target.name })).not.toBeInTheDocument();
      expect(screen.queryByText('12 reviews saved in this run.')).not.toBeInTheDocument();

      finishSecondTarget(secondTarget);

      expect(await screen.findByRole('heading', { name: 'Second target' })).toBeInTheDocument();
      expect(await screen.findByText('No ingestion attempt yet')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: secondTarget.sourceUrl })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: target.sourceUrl })).not.toBeInTheDocument();
      expect(screen.queryByText('12 reviews saved in this run.')).not.toBeInTheDocument();

      // Every surface names Target B, and none still names Target A.
      const ingestion = screen.getByRole('region', { name: 'Review ingestion' });
      const qa = screen.getByRole('region', { name: 'Review Q&A' });
      expect(ingestion).toHaveTextContent('Reviews for Second target');
      expect(within(ingestion).getByText('No ingestion attempt yet')).toBeInTheDocument();
      expect(qa).toHaveTextContent('Ask a question about Second target');
      for (const surface of [ingestion, qa]) {
        expect(surface).not.toHaveTextContent(target.name);
      }
      expect(screen.queryByText(target.name)).not.toBeInTheDocument();
      expect(api.get).toHaveBeenNthCalledWith(3, '/api/analysis-targets/target-2');
      expect(api.get).toHaveBeenNthCalledWith(
        4,
        '/api/analysis-targets/target-2/ingestion-runs/latest',
      );
    });

    it('ignores the previous target’s load when it finishes after the switch', async () => {
      let finishFirstTarget!: (value: typeof target) => void;
      api.get.mockImplementation((path: string) => {
        if (path === '/api/analysis-targets/target-1') {
          return new Promise((resolve) => {
            finishFirstTarget = resolve;
          });
        }
        if (path === '/api/analysis-targets/target-2') return Promise.resolve(secondTarget);
        if (path.endsWith('/target-1/ingestion-runs/latest')) return Promise.resolve(succeededRun);
        return Promise.resolve(null);
      });

      renderPage();
      fireEvent.click(screen.getByRole('link', { name: 'Other target' }));
      expect(await screen.findByRole('heading', { name: 'Second target' })).toBeInTheDocument();

      finishFirstTarget(target);

      await waitFor(() => expect(api.get).toHaveBeenCalledTimes(4));
      expect(screen.getByRole('heading', { name: 'Second target' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: target.name })).not.toBeInTheDocument();
      expect(screen.queryByText('12 reviews saved in this run.')).not.toBeInTheDocument();
    });
  });

  it('shows a safe error when starting ingestion cannot reach the API', async () => {
    api.get.mockResolvedValueOnce(target).mockResolvedValueOnce(null);
    api.post.mockRejectedValueOnce(new ApiError(0, 'Can’t reach ReviewLens right now.'));

    renderPage();
    await screen.findByText(/No ingestion attempt yet/);
    fireEvent.click(screen.getByRole('button', { name: 'Start ingestion' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Can’t reach ReviewLens right now.');
    });
    expect(screen.getByRole('button', { name: 'Start ingestion' })).toBeEnabled();
  });

  it('submits a trimmed question for the active target and displays its answer and context note', async () => {
    api.get.mockResolvedValueOnce(target).mockResolvedValueOnce(null);
    api.post.mockResolvedValueOnce({
      target: { id: target.id, name: target.name, platform: 'google_maps' },
      outcome: 'grounded_answer',
      answer: 'Customers praise the espresso and friendly service.',
      reviewCount: 412,
      context: { reviewsUsed: 280, truncated: true },
    });

    renderPage();
    const questionField = await screen.findByRole('textbox', { name: 'Your question' });
    fireEvent.change(questionField, { target: { value: '  What do customers like?  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask question' }));

    expect(
      await screen.findByRole('heading', { name: 'Answer from My coffee shop’s reviews' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Customers praise the espresso and friendly service.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Based on 280 of 412 reviews.')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/api/analysis-targets/target-1/qa', {
      question: 'What do customers like?',
    });
  });

  it('shows required-field feedback as the user types and prevents blank questions', async () => {
    api.get.mockResolvedValueOnce(target).mockResolvedValueOnce(null);

    renderPage();
    const questionField = await screen.findByRole('textbox', { name: 'Your question' });
    expect(screen.getByRole('button', { name: 'Ask question' })).toBeDisabled();

    fireEvent.change(questionField, { target: { value: '   ' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a question about this target’s reviews.',
    );
    expect(screen.getByRole('button', { name: 'Ask question' })).toBeDisabled();
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.change(questionField, { target: { value: 'What do customers like?' } });
    expect(
      screen.queryByText('Enter a question about this target’s reviews.'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask question' })).toBeEnabled();
  });

  it('shows the loading state and disables duplicate questions while a request is pending', async () => {
    api.get.mockResolvedValueOnce(target).mockResolvedValueOnce(null);
    let finishQuestion!: (answer: {
      target: { id: string; name: string; platform: string };
      outcome: 'insufficient_evidence';
      answer: string;
      reviewCount: number;
      context: { reviewsUsed: number; truncated: boolean };
    }) => void;
    api.post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishQuestion = resolve;
        }),
    );

    renderPage();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your question' }), {
      target: { value: 'Is parking mentioned?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask question' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'ReviewLens is analyzing your question…',
    );
    expect(screen.getByRole('button', { name: 'Asking…' })).toBeDisabled();
    finishQuestion({
      target: { id: target.id, name: target.name, platform: 'google_maps' },
      outcome: 'insufficient_evidence',
      answer: 'The reviews do not mention parking.',
      reviewCount: 12,
      context: { reviewsUsed: 12, truncated: false },
    });
    expect(
      await screen.findByRole('heading', {
        name: 'Not enough evidence in My coffee shop’s reviews',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a safe error when the Q&A request fails', async () => {
    api.get.mockResolvedValueOnce(target).mockResolvedValueOnce(null);
    api.post.mockRejectedValueOnce(new ApiError(503, 'ReviewLens could not answer right now.'));

    renderPage();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your question' }), {
      target: { value: 'What is most popular?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask question' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'ReviewLens could not answer right now.',
    );
    expect(screen.getByRole('button', { name: 'Ask question' })).toBeEnabled();
  });

  it.each([
    ['out_of_scope_refusal', 'Sorry, I can’t answer that'],
    ['no_review_data', 'No reviews available for My coffee shop'],
  ] as const)('labels a %s response', async (outcome, label) => {
    api.get.mockResolvedValueOnce(target).mockResolvedValueOnce(null);
    api.post.mockResolvedValueOnce({
      target: { id: target.id, name: target.name, platform: 'google_maps' },
      outcome,
      answer:
        outcome === 'no_review_data'
          ? 'This target has no ingested reviews yet.'
          : 'I can only answer questions based on reviews.',
      reviewCount: 0,
      context: { reviewsUsed: 0, truncated: false },
    });

    renderPage();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your question' }), {
      target: { value: 'What is the weather?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask question' }));

    expect(await screen.findByRole('heading', { name: label })).toBeInTheDocument();
    // Keep the model's scope explanation visible below the friendlier heading.
    if (outcome === 'out_of_scope_refusal') {
      expect(screen.getByText('I can only answer questions based on reviews.')).toBeInTheDocument();
    }
  });

  it('does not show an earlier target response after switching analysis targets', async () => {
    const secondTarget = { ...target, id: 'target-2', name: 'Second target' };
    api.get
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(secondTarget)
      .mockResolvedValueOnce(null);
    let finishQuestion!: (answer: {
      target: { id: string; name: string; platform: string };
      outcome: 'grounded_answer';
      answer: string;
      reviewCount: number;
      context: { reviewsUsed: number; truncated: boolean };
    }) => void;
    api.post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishQuestion = resolve;
        }),
    );

    renderPage();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your question' }), {
      target: { value: 'What do customers like?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask question' }));
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('link', { name: 'Other target' }));

    expect(await screen.findByRole('heading', { name: 'Second target' })).toBeInTheDocument();
    const secondQuestion = screen.getByRole('textbox', { name: 'Your question' });
    expect(secondQuestion).toHaveValue('');
    finishQuestion({
      target: { id: target.id, name: target.name, platform: 'google_maps' },
      outcome: 'grounded_answer',
      answer: 'First target private response.',
      reviewCount: 12,
      context: { reviewsUsed: 12, truncated: false },
    });

    expect(screen.queryByText('First target private response.')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  describe('no stale Q&A state after switching targets (S2-019)', () => {
    const secondTarget = { ...target, id: 'target-2', name: 'Second target' };

    function mockBothTargets() {
      api.get
        .mockResolvedValueOnce(target)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(secondTarget)
        .mockResolvedValueOnce(null);
    }

    async function switchToSecondTarget() {
      fireEvent.click(screen.getByRole('link', { name: 'Other target' }));
      expect(await screen.findByRole('heading', { name: 'Second target' })).toBeInTheDocument();
      return screen.getByRole('region', { name: 'Review Q&A' });
    }

    it('starts the new target with an empty question, not the unsent draft', async () => {
      mockBothTargets();
      renderPage();
      const draft = 'Do customers mention the espresso at My coffee shop?';
      fireEvent.change(await screen.findByRole('textbox', { name: 'Your question' }), {
        target: { value: draft },
      });

      const qa = await switchToSecondTarget();

      expect(within(qa).getByRole('textbox', { name: 'Your question' })).toHaveValue('');
      expect(screen.queryByDisplayValue(draft)).not.toBeInTheDocument();
      expect(api.post).not.toHaveBeenCalled();
    });

    it('clears the previous target’s Q&A and validation errors', async () => {
      mockBothTargets();
      api.post
        .mockRejectedValueOnce(new ApiError(503, 'ReviewLens could not answer right now.'))
        .mockResolvedValueOnce({
          target: { id: secondTarget.id, name: secondTarget.name, platform: 'google_maps' },
          outcome: 'grounded_answer',
          answer: 'Second target answer.',
          reviewCount: 3,
          context: { reviewsUsed: 3, truncated: false },
        });
      renderPage();
      const question = await screen.findByRole('textbox', { name: 'Your question' });
      fireEvent.change(question, { target: { value: 'What is most popular?' } });
      fireEvent.click(screen.getByRole('button', { name: 'Ask question' }));
      expect(await screen.findByText('ReviewLens could not answer right now.')).toBeInTheDocument();
      // Leave the field blank so Target A also shows its required-field error.
      fireEvent.change(question, { target: { value: '' } });
      expect(screen.getByText('Enter a question about this target’s reviews.')).toBeInTheDocument();

      const qa = await switchToSecondTarget();

      expect(screen.queryByText('ReviewLens could not answer right now.')).not.toBeInTheDocument();
      expect(
        screen.queryByText('Enter a question about this target’s reviews.'),
      ).not.toBeInTheDocument();

      // Target B still works normally after the switch.
      fireEvent.change(within(qa).getByRole('textbox', { name: 'Your question' }), {
        target: { value: 'What is most popular?' },
      });
      fireEvent.click(within(qa).getByRole('button', { name: 'Ask question' }));
      expect(await within(qa).findByText('Second target answer.')).toBeInTheDocument();
      expect(api.post).toHaveBeenLastCalledWith('/api/analysis-targets/target-2/qa', {
        question: 'What is most popular?',
      });
    });
  });
});
