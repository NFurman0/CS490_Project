import { Route, Routes } from 'react-router';
import { HomePage } from '../features/home/pages/HomePage';
import { WorkspaceHomePage } from '../features/workspace/pages/WorkspaceHomePage';
import { CreateTargetPage } from '../features/targets/pages/CreateTargetPage';
import { ApiClientProvider } from '../lib/api-context';
import { AppShell } from './AppShell';
import { NotFoundPage } from './NotFoundPage';
import { RequireSignedIn } from './routing/RequireSignedIn';

interface AppProps {
  apiBaseUrl: string;
}

/**
 * Every route except the home page and "not found" sits under RequireSignedIn,
 * so new protected pages are added inside that route and are guarded by default.
 */
export function App({ apiBaseUrl }: AppProps) {
  return (
    <ApiClientProvider baseUrl={apiBaseUrl}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route element={<RequireSignedIn />}>
            <Route path="analysis-targets/new" element={<CreateTargetPage />} />
            <Route path="analysis-targets" element={<WorkspaceHomePage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </ApiClientProvider>
  );
}
