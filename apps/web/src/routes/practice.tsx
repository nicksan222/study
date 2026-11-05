import { createFileRoute } from '@tanstack/react-router';

import { practiceLoaderDeps, loadPracticeSidebar } from '../app/shell/sidebar-loaders';
import { Page } from '../pages/practice/page';

export const Route = createFileRoute('/practice')({
  staticData: { title: 'Practice', section: 'practice', scope: 'project' },
  loaderDeps: practiceLoaderDeps,
  loader: loadPracticeSidebar,
  component: Page
});
