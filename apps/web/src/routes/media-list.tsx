import { createFileRoute } from '@tanstack/react-router';

import { libraryLoaderDeps, loadLibrarySidebar } from '../app/shell/sidebar-loaders';
import { Page } from '../pages/media-list/page';

export const Route = createFileRoute('/media-list')({
  staticData: { title: 'MediaList', section: 'library', scope: 'project' },
  loaderDeps: libraryLoaderDeps,
  loader: loadLibrarySidebar('library'),
  component: Page
});
