import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design/tokens.css';
import './design/base.css';
import { App } from './app/App.js';
import { messages, startLocale } from './i18n/i18n.js';
import { installHashSync } from './app/routes.js';
import { useAppStore } from './app/store.js';
import { loadLibraryIndex } from './library/manifest.js';

// The library list is fetched first: the URL and the library both read it (manifest.ts). The
// texts of the reader's language arrive alongside, so the page never shows English first.
Promise.all([loadLibraryIndex(), startLocale()])
  .then(() => {
    installHashSync(useAppStore);
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    document.getElementById('root')!.textContent = messages().app.listFailed;
    console.error(error);
  });
