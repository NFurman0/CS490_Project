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

  it('links recent targets to their workspaces', async () => {
    api.get.mockResolvedValue([
      {
        id: 'target-1',
        name: 'Recent cafe',
        platform: 'google_maps',
        sourceUrl: 'https://maps.google.com/?cid=123',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    render(
      <MemoryRouter>
        <RecentTargets />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: 'Recent cafe' })).toHaveAttribute(
      'href',
      '/analysis-targets/target-1',
    );
    expect(api.get).toHaveBeenCalledWith('/api/analysis-targets/recent');
  });

  it('marks only the active target as the current page', async () => {
    api.get.mockResolvedValue([
      {
        id: 'target-1',
        name: 'First cafe',
        platform: 'google_maps',
        sourceUrl: 'https://maps.google.com/?cid=1',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'target-2',
        name: 'Second cafe',
        platform: 'google_maps',
        sourceUrl: 'https://maps.google.com/?cid=2',
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ]);

    render(
      <MemoryRouter initialEntries={['/analysis-targets/target-2']}>
        <RecentTargets />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: 'Second cafe' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'First cafe' })).not.toHaveAttribute('aria-current');
  });

  it('moves the current-page marker when the user switches targets', async () => {
    api.get.mockResolvedValue([
      {
        id: 'target-1',
        name: 'First cafe',
        platform: 'google_maps',
        sourceUrl: 'https://maps.google.com/?cid=1',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'target-2',
        name: 'Second cafe',
        platform: 'google_maps',
        sourceUrl: 'https://maps.google.com/?cid=2',
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ]);

    render(
      <MemoryRouter initialEntries={['/analysis-targets/target-1']}>
        <RecentTargets />
      </MemoryRouter>,
    );

    const first = await screen.findByRole('link', { name: 'First cafe' });
    expect(first).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('link', { name: 'Second cafe' }));

    expect(screen.getByRole('link', { name: 'Second cafe' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(first).not.toHaveAttribute('aria-current');
  });

  it('shows an empty state when there are no recent targets', async () => {
    api.get.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <RecentTargets />
      </MemoryRouter>,
    );

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
      <MemoryRouter>
        <RecentTargets />
        <CreateTargetPage />
      </MemoryRouter>,
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
