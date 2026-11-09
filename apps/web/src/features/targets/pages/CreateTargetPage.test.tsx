import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api-client';
import { CreateTargetPage } from './CreateTargetPage';

const api = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('../../../lib/api-context', () => ({
  useApi: () => ({ get: vi.fn(), post: api.post }),
}));

const validInput = {
  name: "Joe's Pizza",
  sourceUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4',
};

function renderPage() {
  return render(
    <MemoryRouter>
      <CreateTargetPage />
    </MemoryRouter>,
  );
}

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/Target name/), {
    target: { value: validInput.name },
  });
  fireEvent.change(screen.getByLabelText(/Google Maps place URL/), {
    target: { value: validInput.sourceUrl },
  });
}

describe('CreateTargetPage', () => {
  beforeEach(() => {
    api.post.mockReset();
  });

  it('validates required fields as the user types and disables creation until valid', () => {
    renderPage();
    const submit = screen.getByRole('button', { name: 'Create Target' });

    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Target name/), { target: { value: '  ' } });
    expect(screen.getByText('Enter a name for this target.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Target name/), { target: { value: 'Place' } });
    expect(screen.queryByText('Enter a name for this target.')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Google Maps place URL/), {
      target: { value: 'not-a-url' },
    });
    expect(screen.getByText('Enter a valid URL.')).toBeInTheDocument();
    expect(submit).toBeDisabled();
  });

  it('creates a target and links to its workspace and saved source', async () => {
    api.post.mockResolvedValue({
      id: 'target-1',
      ...validInput,
      platform: 'google_maps',
      createdAt: '2026-11-08T12:00:00.000Z',
    });
    renderPage();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Create Target' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/api/analysis-targets', validInput);
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Target created');
    expect(screen.getByRole('status')).toHaveTextContent("Joe's Pizza is saved to your account");
    expect(screen.getByRole('link', { name: 'Open target workspace' })).toHaveAttribute(
      'href',
      '/analysis-targets/target-1',
    );
    expect(screen.getByRole('link', { name: 'Open source in Google Maps' })).toHaveAttribute(
      'href',
      validInput.sourceUrl,
    );
  });

  it('shows the server source-validation message below the URL field', async () => {
    api.post.mockRejectedValue(
      new ApiError(400, 'Please check the highlighted fields.', 'VALIDATION_FAILED', undefined, {
        fieldErrors: { sourceUrl: ['Enter a Google Maps place or share link.'] },
      }),
    );
    renderPage();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Create Target' }));

    expect(await screen.findByText('Enter a Google Maps place or share link.')).toBeInTheDocument();
    expect(screen.queryByText('Target created')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Please check the highlighted fields.');
  });

  it('prevents duplicate submissions while the request is pending', async () => {
    let finishRequest!: (target: {
      id: string;
      name: string;
      platform: 'google_maps';
      sourceUrl: string;
      createdAt: string;
    }) => void;
    api.post.mockReturnValue(
      new Promise((resolve) => {
        finishRequest = resolve;
      }),
    );
    renderPage();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Create Target' }));

    const pendingButton = screen.getByRole('button', { name: 'Creating target…' });
    expect(pendingButton).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Saving your target…');
    expect(api.post).toHaveBeenCalledTimes(1);

    finishRequest({
      id: 'target-1',
      ...validInput,
      platform: 'google_maps',
      createdAt: '2026-11-08T12:00:00.000Z',
    });
    await screen.findByText('Target created');
  });
});
