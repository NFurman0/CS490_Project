import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
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
        <Route path="analysis-targets/:targetId" element={<TargetWorkspacePage />} />
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
    expect(await screen.findByText('Reviews returned from the source: 12')).toBeInTheDocument();
    expect(screen.getByText('Succeeded')).toBeInTheDocument();
    expect(api.get).toHaveBeenNthCalledWith(1, '/api/analysis-targets/target-1');
    expect(api.get).toHaveBeenNthCalledWith(
      2,
      '/api/analysis-targets/target-1/ingestion-runs/latest',
    );
  });

  it('provides an ingestion action and shows its returned result', async () => {
    api.get.mockResolvedValueOnce(target).mockResolvedValueOnce(null);
    api.post.mockResolvedValueOnce({
      ...succeededRun,
      status: 'failed',
      errorCode: 'PROVIDER_ERROR',
      reviewCount: 0,
    });

    renderPage();

    expect(await screen.findByText(/No ingestion attempt yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start ingestion' }));

    expect(api.post).toHaveBeenCalledWith('/api/analysis-targets/target-1/ingestion-runs', {});
    expect(
      await screen.findByText('Review collection did not finish. You can try again.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
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
