import { createRootRouteWithContext } from '@tanstack/react-router';

import type { AppRouterContext } from '../app/router-context';
import { NotFound } from '../app/shell/not-found';
import { Shell } from '../app/shell/shell';
import { loadSidebar } from '../app/shell/sidebar-loaders';
import { validateSearch } from '../lib/navigation/route-contract';

export const Route = createRootRouteWithContext<AppRouterContext>()({
  loader: loadSidebar,
  component: Shell,
  validateSearch,
  notFoundComponent: NotFound
});
