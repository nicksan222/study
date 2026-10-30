import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';

import '@study/ui/styles.css';
import './styles.css';
import { App } from './app';
import { initializeAppearance } from './appearance';

const restoreAppearance = initializeAppearance(document);

import.meta.hot?.dispose(restoreAppearance);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
