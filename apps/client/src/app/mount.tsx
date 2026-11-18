import React from 'react';
import ReactDOM from 'react-dom/client';

import { initializeAppearance } from '../lib/appearance';
import type { ClientModule } from '../lib/client-modules';
import { App } from './app';

export type { ClientModule };

const restoreAppearance = initializeAppearance(document);

import.meta.hot?.dispose(restoreAppearance);

export function mountClient(modules?: readonly ClientModule[]) {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App modules={modules} />
    </React.StrictMode>
  );
}
