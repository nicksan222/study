import { createFileRoute } from '@tanstack/react-router';

import { Page } from '../pages/settings/page';

export const Route = createFileRoute('/Settings')({
  staticData: { title: 'Settings', section: 'sessions', scope: 'global' },
  component: Page
});
