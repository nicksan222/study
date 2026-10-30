import { createFileRoute } from '@tanstack/react-router';

import { libraryLoaderDeps, loadLibrarySidebar } from '../app/shell/sidebar-loaders';
import { Page } from '../pages/diagrams/page';

export const Route = createFileRoute('/diagrams')({
  staticData: { title: 'Diagrams', section: 'library', scope: 'project' },
  loaderDeps: libraryLoaderDeps,
  loader: loadLibrarySidebar('library'),
  component: Page
});
