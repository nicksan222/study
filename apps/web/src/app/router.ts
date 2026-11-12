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

  const router = createRouter({
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
    defaultViewTransition: false,
    defaultPendingComponent: RoutePending,
    defaultErrorComponent: RouteError,
    // IDs are 64-bit decimal strings; JSON search parsing would lose precision.
    parseSearch: (search) => Object.fromEntries(new URLSearchParams(search)),
    stringifySearch: stringifySearchWith(String)
  });

  router.subscribe('onBeforeLoad', () => {
    // Root zoom must settle before snapshots; zoomed Chromium snapshots can fail prepaint.
    router.update({
      ...router.options,
      defaultViewTransition:
        document.documentElement.style.zoom === '100%' &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    });
  });

  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
