import { ClerkProvider } from '@clerk/react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';

/** Lets Clerk navigate inside the app (no full page reload) after sign-in and sign-out. */
export function ClerkProviderWithRouter({
  publishableKey,
  children,
}: {
  publishableKey: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      afterSignOutUrl="/"
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
    >
      {children}
    </ClerkProvider>
  );
}
