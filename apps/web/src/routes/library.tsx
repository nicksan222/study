import { createFileRoute } from '@tanstack/react-router';

import { LibraryPage, libraryRouteLoader, libraryRouteDeps } from '../features/material-library';

export const Route = createFileRoute('/library')({
  staticData: { title: 'SidebarLibrary', section: 'library', scope: 'global' },
  loaderDeps: libraryRouteDeps,
  loader: libraryRouteLoader,
  component: LibraryPage
});
