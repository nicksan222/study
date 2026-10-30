import { createFileRoute } from '@tanstack/react-router';

import { libraryLoaderDeps, loadLibrarySidebar } from '../app/shell/sidebar-loaders';
import { Page } from '../pages/flashcards/page';

export const Route = createFileRoute('/flashcards')({
  staticData: { title: 'Flashcards', section: 'practice', scope: 'project' },
  loaderDeps: libraryLoaderDeps,
  loader: loadLibrarySidebar('practice'),
  component: Page
});
