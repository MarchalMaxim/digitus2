import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design/tokens.css';
import './design/base.css';
import { App } from './app/App.js';
import { installHashSync } from './app/routes.js';
import { useAppStore } from './app/store.js';
import { loadLibraryIndex } from './library/manifest.js';

// The library list is fetched first: the URL and the library both read it (manifest.ts).
loadLibraryIndex()
  .then(() => {
    installHashSync(useAppStore);
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    document.getElementById('root')!.textContent =
      'digitus2 could not load its piece list. Check the connection and reload the page.';
    console.error(error);
  });
