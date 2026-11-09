import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api-client';
import { WorkspaceHomePage } from './WorkspaceHomePage';

const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../../lib/api-context', () => ({
  useApi: () => ({ get: api.get }),
}));

describe('WorkspaceHomePage', () => {
  beforeEach(() => {
    api.get.mockReset();
  });

  it('lists the signed-in user’s targets with platform and source URL', async () => {
    api.get.mockResolvedValue([
      {
        id: 'target-1',
        name: 'My coffee shop',
        platform: 'google_maps',
        sourceUrl: 'https://maps.google.com/?cid=123',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    render(
      <MemoryRouter>
        <WorkspaceHomePage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'My coffee shop' })).toBeInTheDocument();
    expect(screen.getByText('Review platform:')).toBeInTheDocument();
    expect(screen.getByText('Google Maps')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://maps.google.com/?cid=123' })).toHaveAttribute(
      'href',
      'https://maps.google.com/?cid=123',
    );
    expect(screen.getByRole('link', { name: 'My coffee shop' })).toHaveAttribute(
      'href',
      '/analysis-targets/target-1',
    );
    expect(api.get).toHaveBeenCalledWith('/api/analysis-targets');
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('shows a useful empty state when the user has no targets', async () => {
    api.get.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <WorkspaceHomePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('You haven’t created any targets yet.')).toBeInTheDocument();
  });

  it('shows a safe error when loading the target list fails', async () => {
    api.get.mockRejectedValue(new ApiError(500, 'Targets could not be loaded.'));

    render(
      <MemoryRouter>
        <WorkspaceHomePage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Targets could not be loaded.');
  });
});
