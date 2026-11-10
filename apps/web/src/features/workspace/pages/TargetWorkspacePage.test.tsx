import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api-client';
import { TargetWorkspacePage } from './TargetWorkspacePage';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('../../../lib/api-context', () => ({
  useApi: () => api,
}));

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

  it('shows saved reviews and warns when collection stopped early', async () => {
    api.get.mockResolvedValueOnce(target).mockResolvedValueOnce({
      ...succeededRun,
      errorCode: 'PROVIDER_TIMEOUT',
    });

    renderPage();

    expect(await screen.findByText('12 reviews saved in this run.')).toBeInTheDocument();
    expect(screen.getByText('Succeeded')).toBeInTheDocument();
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
});
