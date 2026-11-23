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
      appearance={{
        signIn: {
          variables: { colorPrimary: '#1b56fd', fontFamily: 'var(--font-body)' },
          elements: {
            // Development instances allow unbranded UI. Production uses the Clerk dashboard setting.
            footer: publishableKey.startsWith('pk_test_')
              ? 'reviewlens-sign-in-dev-footer'
              : undefined,
          },
        },
      }}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
    >
      {children}
    </ClerkProvider>
  );
}
