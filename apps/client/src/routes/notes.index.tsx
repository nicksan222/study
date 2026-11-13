import { createFileRoute } from '@tanstack/react-router';

import { Page } from '../pages/notes/page';

export const Route = createFileRoute('/notes/')({
  staticData: { title: 'Notes', section: 'notes', scope: 'project' },
  component: Page
});
