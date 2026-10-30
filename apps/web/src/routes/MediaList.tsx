import { createFileRoute } from '@tanstack/react-router';

import { Page } from '../pages/media-list/page';

export const Route = createFileRoute('/MediaList')({
  staticData: { title: 'MediaList', section: 'library', scope: 'project' },
  component: Page
});
