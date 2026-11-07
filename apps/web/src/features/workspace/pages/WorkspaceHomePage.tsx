import { useApi } from '../../../lib/api-context';
import { SessionStatus } from '../../auth/components/SessionStatus';

/** Signed-in landing page. The analysis target list (S1-017) replaces the placeholder text. */
export function WorkspaceHomePage() {
  const client = useApi();
  return (
    <>
      <h1>Analysis targets</h1>
      <SessionStatus client={client} />
      <p>Your analysis targets will appear here.</p>
    </>
  );
}
