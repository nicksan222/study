import { createFileRoute } from '@tanstack/react-router';

import { Page } from '../pages/projects/page';

export const Route = createFileRoute('/Projects')({
  staticData: { title: 'Projects', section: 'sessions', scope: 'global' },
  component: Page
});
