import { Show, useAuth } from '@clerk/react';
import { Link, Outlet } from 'react-router';
import { AccountControls } from '../features/auth/components/AccountControls';
import { RecentTargets } from '../features/targets/components/RecentTargets';

/**
 * The shell every page shares: a top banner with the account controls on the
 * right and a focused main area. The analysis target navigation (S1-017) is
 * added here as a left sidebar for signed-in users.
 */
export function AppShell() {
  const { isLoaded, isSignedIn } = useAuth();
  const hasSidebar = isLoaded && isSignedIn;

  return (
    <div className="shell">
      <header className="shell-header">
        <Link to="/" className="wordmark">
          ReviewLens
        </Link>
        <AccountControls />
      </header>
      <div className={`shell-body${hasSidebar ? ' shell-body-with-sidebar' : ''}`}>
        <Show when="signed-in">
          <aside className="shell-sidebar">
            <nav aria-label="Analysis targets">
              <div className="sidebar-actions">
                <Link to="/analysis-targets" className="button button-secondary">
                  View all
                </Link>
                <Link
                  to="/analysis-targets/new"
                  className="button button-primary create-target-link"
                >
                  <span aria-hidden="true">＋</span>
                  Create Target
                </Link>
              </div>
              <RecentTargets />
            </nav>
          </aside>
        </Show>
        <main className="shell-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
