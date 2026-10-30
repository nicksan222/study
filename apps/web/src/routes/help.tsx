import { createFileRoute } from '@tanstack/react-router';

import { Page } from '../pages/help/page';

export const Route = createFileRoute('/help')({
  staticData: { title: 'Help', section: 'sessions', scope: 'global' },
  component: Page
});
