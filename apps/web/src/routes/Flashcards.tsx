import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/Flashcards')({
  staticData: { page: 'Flashcards' },
  component: () => null
});
