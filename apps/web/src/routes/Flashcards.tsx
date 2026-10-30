import { createFileRoute } from '@tanstack/react-router';

import { Page } from '../pages/flashcards/page';

export const Route = createFileRoute('/Flashcards')({
  staticData: { title: 'Flashcards', section: 'practice', scope: 'project' },
  component: Page
});
