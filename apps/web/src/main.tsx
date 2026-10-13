import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design/tokens.css';
import './design/base.css';
import { App } from './app/App.js';
import { installHashSync } from './app/routes.js';
import { useAppStore } from './app/store.js';

installHashSync(useAppStore);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
