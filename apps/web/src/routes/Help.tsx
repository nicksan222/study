import { createFileRoute } from '@tanstack/react-router';

import { Page } from '../pages/help/page';

export const Route = createFileRoute('/Help')({
  staticData: { title: 'Help', section: 'sessions', scope: 'global' },
  component: Page
});
