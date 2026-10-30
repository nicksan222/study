import { createFileRoute } from '@tanstack/react-router';

import { Page } from '../pages/pipelines/page';

export const Route = createFileRoute('/pipelines')({
  staticData: { title: 'Pipelines', section: 'pipelines', scope: 'project' },
  component: Page
});
