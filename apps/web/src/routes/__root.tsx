import { createRootRoute, Navigate } from '@tanstack/react-router';

import { Shell } from '../shell';

export const Route = createRootRoute({
  component: Shell,
  notFoundComponent: () => <Navigate to="/Home" replace />
});
