import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

// Clerk is replaced with a controllable fake: tests never contact Clerk.
const clerk = vi.hoisted(() => ({
  isLoaded: true,
  isSignedIn: false,
  getToken: async (): Promise<string | null> => 'session-token',
}));

vi.mock('@clerk/react', () => ({
  Show: ({ when, children }: { when: 'signed-in' | 'signed-out'; children: ReactNode }) =>
    clerk.isLoaded && (when === 'signed-in') === clerk.isSignedIn ? children : null,
  SignInButton: ({ children }: { children: ReactNode }) => children,
  UserButton: () => <button type="button">Open account menu</button>,
  useAuth: () => ({
    isLoaded: clerk.isLoaded,
    isSignedIn: clerk.isLoaded ? clerk.isSignedIn : undefined,
    getToken: clerk.getToken,
  }),
}));

function CurrentLocation() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderAt(path: string) {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ data: { authenticated: true } }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <App apiBaseUrl="http://localhost:3000" />
      <CurrentLocation />
    </MemoryRouter>,
  );
  return { ...view, fetchMock };
}

const location = () => screen.getByTestId('location').textContent;

afterEach(() => {
  vi.unstubAllGlobals();
  clerk.isLoaded = true;
  clerk.isSignedIn = false;
});

describe('protected pages', () => {
  it('redirects a signed-out user to sign in, remembering where they were going', () => {
    const { fetchMock } = renderAt('/analysis-targets');

    expect(location()).toBe('/?returnTo=%2Fanalysis-targets');
    expect(screen.queryByRole('heading', { name: 'Analysis targets' })).not.toBeInTheDocument();
    expect(screen.getByText('Sign in to continue to that page.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Create Target/ })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows nothing protected while the session is still being checked', () => {
    clerk.isLoaded = false;
    const { fetchMock } = renderAt('/analysis-targets');

    expect(screen.getByRole('status')).toHaveTextContent('Checking your sign-in…');
    expect(screen.queryByRole('heading', { name: 'Analysis targets' })).not.toBeInTheDocument();
    expect(location()).toBe('/analysis-targets');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a protected page to a signed-in user and calls the API with their token', async () => {
    clerk.isSignedIn = true;
    const { fetchMock } = renderAt('/analysis-targets');

    expect(screen.getByRole('heading', { name: 'Analysis targets' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Create Target/ })).toHaveAttribute(
      'href',
      '/analysis-targets/new',
    );
    expect(
      await screen.findByText('You’re signed in and connected to ReviewLens.'),
    ).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer session-token');
  });

  it('shows the create-target form to a signed-in user', () => {
    clerk.isSignedIn = true;
    renderAt('/analysis-targets/new');

    expect(screen.getByRole('heading', { name: 'Create an analysis target' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Create Target/ })).toBeInTheDocument();
  });

  it('removes protected content and redirects as soon as the user signs out', async () => {
    clerk.isSignedIn = true;
    const { rerender } = renderAt('/analysis-targets');
    await screen.findByText('You’re signed in and connected to ReviewLens.');

    clerk.isSignedIn = false;
    rerender(
      <MemoryRouter initialEntries={['/analysis-targets']}>
        <App apiBaseUrl="http://localhost:3000" />
        <CurrentLocation />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('heading', { name: 'Analysis targets' })).not.toBeInTheDocument();
    expect(location()).toBe('/?returnTo=%2Fanalysis-targets');
  });
});

describe('home page', () => {
  it('offers sign-in to a signed-out user', () => {
    renderAt('/');

    expect(screen.getByRole('banner')).toHaveTextContent('ReviewLens');
    expect(screen.getAllByRole('button', { name: /sign in/i }).length).toBeGreaterThan(0);
    expect(location()).toBe('/');
  });

  it('returns a signed-in user to the page they originally requested', () => {
    clerk.isSignedIn = true;
    renderAt('/?returnTo=%2Fanalysis-targets');

    expect(location()).toBe('/analysis-targets');
    expect(screen.getByRole('button', { name: 'Open account menu' })).toBeInTheDocument();
  });

  it('never redirects a signed-in user to another site', () => {
    clerk.isSignedIn = true;
    renderAt('/?returnTo=https%3A%2F%2Fevil.example%2Fphish');

    expect(location()).toBe('/analysis-targets');
  });
});

describe('errors', () => {
  it('shows a not-found page for unknown addresses', () => {
    renderAt('/no-such-page');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('explains in plain language when the API rejects the session', async () => {
    clerk.isSignedIn = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'azp mismatch' } }),
            { status: 401 },
          ),
      ),
    );
    render(
      <MemoryRouter initialEntries={['/analysis-targets']}>
        <App apiBaseUrl="http://localhost:3000" />
      </MemoryRouter>,
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your session has ended. Sign in again to continue.');
    expect(alert).not.toHaveTextContent('azp');
  });
});
