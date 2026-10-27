import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/Practice')({
  staticData: { page: 'Practice' },
  component: () => null
});
