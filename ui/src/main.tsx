import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './theme.css'; // design-system theme layer: must stay the last stylesheet
import { App } from './App';
import { getStoredTheme, setTheme } from './theme';

// Apply stored theme immediately (also done by the inline script in index.html,
// but this ensures the React tree sees the same value after hydration).
setTheme(getStoredTheme());

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
