import { createBrowserHistory, createRouter, stringifySearchWith } from '@tanstack/react-router';

import { createStudyQueryClient } from '../lib/query-client';
import { routeTree } from '../routeTree.gen';
import { RouteError, RoutePending } from './shell/route-feedback';

export function createAppRouter(
  history = createBrowserHistory(),
  queryClient = createStudyQueryClient()
) {
  return createRouter({
    routeTree,
    history,
    context: { queryClient },
    defaultPendingComponent: RoutePending,
    defaultErrorComponent: RouteError,
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
