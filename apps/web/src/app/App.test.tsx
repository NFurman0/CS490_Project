import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

// Clerk is replaced with a controllable fake: tests never contact Clerk.
const clerk = vi.hoisted(() => ({
  signedIn: false,
  getToken: async (): Promise<string | null> => 'session-token',
}));

vi.mock('@clerk/react', () => ({
  Show: ({ when, children }: { when: 'signed-in' | 'signed-out'; children: ReactNode }) =>
    (when === 'signed-in') === clerk.signedIn ? children : null,
  ClerkLoading: () => null,
  SignInButton: ({ children }: { children: ReactNode }) => children,
  UserButton: () => <button type="button">Open account menu</button>,
  useAuth: () => ({ getToken: clerk.getToken }),
}));

function mockApi(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  clerk.signedIn = false;
});

describe('App', () => {
  it('shows sign-in options and no workspace when signed out', () => {
    const fetchMock = mockApi(200, {});
    render(<App apiBaseUrl="http://localhost:3000" />);

    expect(screen.getByRole('banner')).toHaveTextContent('ReviewLens');
    expect(screen.getAllByRole('button', { name: /sign in/i }).length).toBeGreaterThan(0);
    expect(screen.queryByText('Review analysis workspace')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the account menu and confirms the API session when signed in', async () => {
    clerk.signedIn = true;
    const fetchMock = mockApi(200, { data: { authenticated: true } });
    render(<App apiBaseUrl="http://localhost:3000" />);

    expect(screen.getByRole('button', { name: 'Open account menu' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
    expect(
      await screen.findByText('You’re signed in and connected to ReviewLens.'),
    ).toBeInTheDocument();

    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer session-token');
  });

  it('explains the problem in plain language when the API rejects the session', async () => {
    clerk.signedIn = true;
    mockApi(401, { error: { code: 'UNAUTHENTICATED', message: 'token expired: azp mismatch' } });
    render(<App apiBaseUrl="http://localhost:3000" />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your session has ended. Sign in again to continue.');
    expect(alert).not.toHaveTextContent('azp');
  });
});
