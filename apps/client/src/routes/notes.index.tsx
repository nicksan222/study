import { createFileRoute } from '@tanstack/react-router';

import { pagesRouteDeps, pagesRouteLoader } from '../features/pages';
import { DocumentsIndex } from '../pages/notes/page';

export const Route = createFileRoute('/notes/')({
  staticData: { title: 'Documents', section: 'notes', scope: 'project' },
  loaderDeps: pagesRouteDeps,
  loader: pagesRouteLoader,
  component: DocumentsIndex
});
