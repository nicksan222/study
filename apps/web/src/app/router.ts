import { createBrowserHistory, createRouter, stringifySearchWith } from '@tanstack/react-router';

import { canonicalProjectHref, projectUrlRewrite } from '../lib/navigation/project-urls';
import { createStudyQueryClient } from '../lib/query-client';
import { routeTree } from '../routeTree.gen';
import { RouteError, RoutePending } from './shell/route-feedback';

export function createAppRouter(
  history = createBrowserHistory(),
  queryClient = createStudyQueryClient()
) {
  const href = canonicalProjectHref(history.location.href);

  if (href !== history.location.href) history.replace(href, history.location.state);

  return createRouter({
    routeTree,
    // Custom-scheme URLs serialize with a null origin, making internal rewrites external.
    origin:
      typeof window !== 'undefined' &&
      (window.origin === 'tauri://localhost' || window.location.protocol === 'tauri:')
        ? 'http://localhost'
        : undefined,
    rewrite: projectUrlRewrite,
    history,
    context: { queryClient },
    defaultViewTransition: true,
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
