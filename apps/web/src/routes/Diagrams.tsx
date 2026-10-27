import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/Diagrams')({
  staticData: { page: 'Diagrams' },
  component: () => null
});
