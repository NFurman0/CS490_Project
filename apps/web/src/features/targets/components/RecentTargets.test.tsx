import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecentTargets } from './RecentTargets';

const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../../lib/api-context', () => ({
  useApi: () => ({ get: api.get }),
}));

describe('RecentTargets', () => {
  beforeEach(() => {
    api.get.mockReset();
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
});
