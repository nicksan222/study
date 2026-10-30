import { createFileRoute } from '@tanstack/react-router';

import { Page } from '../pages/settings/page';

export const Route = createFileRoute('/settings')({
  staticData: { title: 'Settings', section: 'sessions', scope: 'global' },
  component: Page
});
