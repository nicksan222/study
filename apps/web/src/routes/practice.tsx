import { createFileRoute } from '@tanstack/react-router';

import { libraryLoaderDeps, loadLibrarySidebar } from '../app/shell/sidebar-loaders';
import { Page } from '../pages/practice/page';

export const Route = createFileRoute('/practice')({
  staticData: { title: 'Practice', section: 'practice', scope: 'project' },
  loaderDeps: libraryLoaderDeps,
  loader: loadLibrarySidebar('practice'),
  component: Page
});
