import { createFileRoute } from '@tanstack/react-router';

import { practiceLoaderDeps, loadPracticeSidebar } from '../app/shell/sidebar-loaders';
import { Page } from '../pages/flashcards/page';

export const Route = createFileRoute('/flashcards/')({
  staticData: { header: 'workspace', title: 'Flashcards', section: 'practice', scope: 'project' },
  loaderDeps: practiceLoaderDeps,
  loader: loadPracticeSidebar,
  component: Page
});
