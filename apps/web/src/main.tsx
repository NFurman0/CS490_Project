import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './app/App';
import { ConfigErrorScreen } from './app/ConfigErrorScreen';
import { ClerkProviderWithRouter } from './app/routing/ClerkProviderWithRouter';
import { parseWebEnv } from './config/env';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element in index.html');

const config = parseWebEnv(import.meta.env);

createRoot(root).render(
  <StrictMode>
    {config.ok ? (
      <BrowserRouter>
        <ClerkProviderWithRouter publishableKey={config.env.VITE_CLERK_PUBLISHABLE_KEY}>
          <App apiBaseUrl={config.env.VITE_API_BASE_URL} />
        </ClerkProviderWithRouter>
      </BrowserRouter>
    ) : (
      <ConfigErrorScreen problems={config.problems} />
    )}
  </StrictMode>,
);
