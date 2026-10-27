import { createHashHistory, createRouter, stringifySearchWith } from '@tanstack/react-router';

import { routeTree } from './routeTree.gen';

export function createAppRouter() {
  return createRouter({
    routeTree,
    history: createHashHistory(),
    // IDs are 64-bit decimal strings; JSON search parsing would lose precision.
    parseSearch: (search) => Object.fromEntries(new URLSearchParams(search)),
    stringifySearch: stringifySearchWith(String)
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
