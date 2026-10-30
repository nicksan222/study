import { createRootRoute } from '@tanstack/react-router';

import { NotFound } from '../app/shell/not-found';
import { Shell } from '../app/shell/shell';
import { validateSearch } from '../lib/navigation/route-contract';

export const Route = createRootRoute({
  component: Shell,
  validateSearch,
  notFoundComponent: NotFound
});
