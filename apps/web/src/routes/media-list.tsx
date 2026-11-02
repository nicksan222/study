import { createFileRoute } from '@tanstack/react-router';

import { libraryRouteLoader, libraryRouteDeps } from '../features/material-library';
import { Page } from '../pages/media-list/page';

export const Route = createFileRoute('/media-list')({
  staticData: { title: 'SidebarLibrary', section: 'library', scope: 'global' },
  loaderDeps: libraryRouteDeps,
  loader: libraryRouteLoader,
  component: Page
});
