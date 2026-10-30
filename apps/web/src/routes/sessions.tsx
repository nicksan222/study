import { createFileRoute } from '@tanstack/react-router';

import { Page } from '../pages/sessions/page';

export const Route = createFileRoute('/sessions')({
  staticData: { title: 'Sessions', section: 'sessions', scope: 'project' },
  component: Page
});
