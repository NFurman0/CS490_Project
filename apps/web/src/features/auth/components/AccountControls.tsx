import { Show, SignInButton, UserButton } from '@clerk/react';

/**
 * Top-right account controls (UI/UX Standards §1): a sign-in button when signed
 * out, and Clerk's account menu (manage account, sign out) when signed in.
 */
export function AccountControls() {
  return (
    <div className="account-controls">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button type="button" className="button button-primary">
            Sign in
          </button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </div>
  );
}
