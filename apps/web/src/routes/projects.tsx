import { createFileRoute } from '@tanstack/react-router';

import { Page } from '../pages/projects/page';

export const Route = createFileRoute('/projects')({
  staticData: { title: 'Projects', section: 'sessions', scope: 'global' },
  component: Page
});
