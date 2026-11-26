import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@buffmomo/zeditor/style.css';
import { App } from './App';

// Strict Mode mounts, unmounts and re-mounts every component in development:
// the editor must survive that without leaking listeners or duplicating DOM.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
