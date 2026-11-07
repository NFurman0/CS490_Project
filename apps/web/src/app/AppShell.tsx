import { Link, Outlet } from 'react-router';
import { AccountControls } from '../features/auth/components/AccountControls';

/**
 * The shell every page shares: a top banner with the account controls on the
 * right and a focused main area. The analysis target navigation (S1-017) is
 * added here as a left sidebar for signed-in users.
 */
export function AppShell() {
  return (
    <div className="shell">
      <header className="shell-header">
        <Link to="/" className="wordmark">
          ReviewLens
        </Link>
        <AccountControls />
      </header>
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}
