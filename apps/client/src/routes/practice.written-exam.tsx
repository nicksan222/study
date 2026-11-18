import { createFileRoute } from '@tanstack/react-router';

import { loadPracticeSidebar, practiceLoaderDeps } from '../app/shell/sidebar-loaders';
import { WrittenExamPage } from '../features/practice';

export const Route = createFileRoute('/practice/written-exam')({
  staticData: { header: 'workspace', title: 'WrittenExam', section: 'practice', scope: 'project' },
  loaderDeps: practiceLoaderDeps,
  loader: loadPracticeSidebar,
  component: WrittenExamPage
});
