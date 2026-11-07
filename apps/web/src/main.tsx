import { ClerkProvider } from '@clerk/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { ConfigErrorScreen } from './app/ConfigErrorScreen';
import { parseWebEnv } from './config/env';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element in index.html');

const config = parseWebEnv(import.meta.env);

createRoot(root).render(
  <StrictMode>
    {config.ok ? (
      <ClerkProvider publishableKey={config.env.VITE_CLERK_PUBLISHABLE_KEY} afterSignOutUrl="/">
        <App apiBaseUrl={config.env.VITE_API_BASE_URL} />
      </ClerkProvider>
    ) : (
      <ConfigErrorScreen problems={config.problems} />
    )}
  </StrictMode>,
);
