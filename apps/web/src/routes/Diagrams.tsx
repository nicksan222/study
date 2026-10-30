import { createFileRoute } from '@tanstack/react-router';

import { Page } from '../pages/diagrams/page';

export const Route = createFileRoute('/Diagrams')({
  staticData: { title: 'Diagrams', section: 'library', scope: 'project' },
  component: Page
});
