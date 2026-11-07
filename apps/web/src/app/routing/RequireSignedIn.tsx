import { useAuth } from '@clerk/react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { LoadingState } from '../../components/ui/LoadingState';
import { signInPathFor } from '../../lib/return-to';

/**
 * Guards every protected page. Nothing protected renders until Clerk confirms a
 * session; signed-out users are sent to sign in and returned here afterwards.
 * This is a UX control only: the API independently rejects unauthenticated requests.
 */
export function RequireSignedIn() {
  const { isLoaded, isSignedIn } = useAuth();
  const location = useLocation();

  if (!isLoaded) return <LoadingState label="Checking your sign-in…" />;
  if (!isSignedIn) {
    const destination = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={signInPathFor(destination)} replace />;
  }
  return <Outlet />;
}
