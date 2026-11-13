import { createFileRoute } from '@tanstack/react-router';

import { PagesPage, pagesRouteDeps, pagesRouteLoader } from '../features/pages';

export const Route = createFileRoute('/pages/')({
  staticData: { title: 'SourcePage', section: 'pages', scope: 'project' },
  loaderDeps: pagesRouteDeps,
  loader: pagesRouteLoader,
  component: PagesPage
});
