import { createFileRoute } from '@tanstack/react-router';

import { Page } from '../pages/media-list/page';

export const Route = createFileRoute('/media-list')({
  staticData: { title: 'SidebarLibrary', section: 'library', scope: 'global' },
  component: Page
});
