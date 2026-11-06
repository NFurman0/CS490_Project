import { ClerkLoading, Show, SignInButton } from '@clerk/react';
import { AccountControls } from '../features/auth/components/AccountControls';
import { SessionStatus } from '../features/auth/components/SessionStatus';
import { useApiClient } from '../lib/use-api-client';

interface AppProps {
  apiBaseUrl: string;
}

/**
 * Application shell: a top banner with the account controls on the right and a
 * focused main area. The analysis target navigation (S1-017)
 * is added as a left sidebar inside this shell.
 */
export function App({ apiBaseUrl }: AppProps) {
  const client = useApiClient(apiBaseUrl);

  return (
    <div className="shell">
      <header className="shell-header">
        <span className="wordmark">ReviewLens</span>
        <AccountControls />
      </header>
      <main className="shell-main">
        <ClerkLoading>
          <p role="status">Loading…</p>
        </ClerkLoading>
        <Show when="signed-out">
          <h1>Find out what customers keep saying</h1>
          <p>
            Sign in to create an analysis target, collect its Google Maps reviews, and see what
            customers praise and complain about.
          </p>
          <SignInButton mode="modal">
            <button type="button" className="button button-primary">
              Sign in to get started
            </button>
          </SignInButton>
        </Show>
        <Show when="signed-in">
          <h1>Review analysis workspace</h1>
          <SessionStatus client={client} />
        </Show>
      </main>
    </div>
  );
}
