import { language } from '#backend/procedures/settings/operations/get-app-settings';

import type { App } from './service.ts';

export interface Refresh {
  subscribe(listener: () => void): () => void;
  publish(): void;
}

/** Process resources shared by procedures; persistence is accessed through the shared database. */
export function createProcedureContext(
  app: App,
  refresh: Refresh = {
    subscribe: (listener) => app.subscribe(listener),
    publish: () => {}
  },
  shutdown: AbortSignal = new AbortController().signal
) {
  const store = app.store;
  const wake = () => app.workers.wake();

  return {
    store,
    shutdown,
    language: () => language(store),
    wake,
    auth: app,
    workers: app.workers,
    refresh
  };
}

export type ProcedureContext = ReturnType<typeof createProcedureContext>;
