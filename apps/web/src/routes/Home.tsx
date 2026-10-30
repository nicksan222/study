import { createFileRoute } from '@tanstack/react-router';

import { Page } from '../pages/home/page';

export const Route = createFileRoute('/Home')({
  staticData: { title: 'Home', section: 'sessions', scope: 'project' },
  component: Page
});
