import { SignInButton, useAuth } from '@clerk/react';
import { Navigate, useSearchParams } from 'react-router';
import { LoadingState } from '../../../components/ui/LoadingState';
import { safeReturnTo } from '../../../lib/return-to';

const DEFAULT_DESTINATION = '/analysis-targets';

/**
 * Public start page. Signed-in users go straight to where they were headed
 * (`returnTo`, if it is a safe internal path) or to their analysis targets.
 */
export function HomePage() {
  const { isLoaded, isSignedIn } = useAuth();
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));

  if (!isLoaded) return <LoadingState label="Loading…" />;
  if (isSignedIn) return <Navigate to={returnTo ?? DEFAULT_DESTINATION} replace />;

  return (
    <>
      <h1>Find out what customers keep saying</h1>
      {returnTo && <p className="notice">Sign in to continue to that page.</p>}
      <p>
        Sign in to create an analysis target, collect its Google Maps reviews, and see what
        customers praise and complain about.
      </p>
      <SignInButton mode="modal">
        <button type="button" className="button button-primary">
          Sign in to get started
        </button>
      </SignInButton>
    </>
  );
}
