/**
 * Application shell. Sign-in (S1-009), route protection (S1-010), and the
 * analysis target screens (S1-015 to S1-018) are added inside this shell.
 * Visual conventions come from docs/ui-ux-standards.md (S1-002).
 */
export function App() {
  return (
    <div className="shell">
      <header className="shell-header">
        <span className="wordmark">ReviewLens</span>
      </header>
      <main className="shell-main">
        <h1>Review analysis workspace</h1>
        <p>Sign in to create an analysis target and collect its Google Maps reviews.</p>
      </main>
    </div>
  );
}
