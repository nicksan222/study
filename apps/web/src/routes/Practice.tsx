import { createFileRoute } from '@tanstack/react-router';

import { Page } from '../pages/practice/page';

export const Route = createFileRoute('/Practice')({
  staticData: { title: 'Practice', section: 'practice', scope: 'project' },
  component: Page
});
