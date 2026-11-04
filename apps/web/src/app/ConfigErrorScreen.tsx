interface ConfigErrorScreenProps {
  problems: string[];
}

/** Shown instead of the app when browser configuration is missing or invalid. */
export function ConfigErrorScreen({ problems }: ConfigErrorScreenProps) {
  return (
    <main className="shell-main" role="alert">
      <h1>ReviewLens can’t start</h1>
      <p>The web app’s configuration is incomplete:</p>
      <ul>
        {problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
      <p>
        Copy <code>apps/web/.env.example</code> to <code>apps/web/.env</code>, fill in these values,
        and restart <code>npm run dev</code>.
      </p>
    </main>
  );
}
