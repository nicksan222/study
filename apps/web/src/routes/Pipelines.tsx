import { createFileRoute } from '@tanstack/react-router';

import { Page } from '../pages/pipelines/page';

export const Route = createFileRoute('/Pipelines')({
  staticData: { title: 'Pipelines', section: 'pipelines', scope: 'project' },
  component: Page
});
