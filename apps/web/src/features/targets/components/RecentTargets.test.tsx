import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateTargetPage } from '../pages/CreateTargetPage';
import { RecentTargets } from './RecentTargets';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('../../../lib/api-context', () => ({
  useApi: () => api,
}));

describe('RecentTargets', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
  });

  it('shows a short, non-clickable list of recent targets', async () => {
    api.get.mockResolvedValue([
      {
        id: 'target-1',
        name: 'Recent cafe',
        platform: 'google_maps',
        sourceUrl: 'https://maps.google.com/?cid=123',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    render(<RecentTargets />);

    expect(await screen.findByText('Recent cafe')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/api/analysis-targets/recent');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no recent targets', async () => {
    api.get.mockResolvedValue([]);

    render(<RecentTargets />);

    expect(await screen.findByText('Your targets will appear here.')).toBeInTheDocument();
  });

  it('refreshes the recent list after a target is successfully created', async () => {
    const createdTarget = {
      id: 'target-new',
      name: 'New target',
      platform: 'google_maps' as const,
      sourceUrl: 'https://maps.google.com/?cid=456',
      createdAt: '2026-01-02T00:00:00.000Z',
    };
    api.get.mockResolvedValueOnce([]).mockResolvedValue([createdTarget]);
    api.post.mockResolvedValue(createdTarget);

    render(
      <>
        <RecentTargets />
        <MemoryRouter>
          <CreateTargetPage />
        </MemoryRouter>
      </>,
    );

    const recentTargets = screen.getByRole('region', { name: 'Recent targets' });
    expect(
      await within(recentTargets).findByText('Your targets will appear here.'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Target name/), {
      target: { value: createdTarget.name },
    });
    fireEvent.change(screen.getByLabelText(/Google Maps place URL/), {
      target: { value: createdTarget.sourceUrl },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Target' }));

    expect(await screen.findByText('Target created')).toBeInTheDocument();
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledTimes(2);
      expect(within(recentTargets).getByText('New target')).toBeInTheDocument();
    });
  });
});
