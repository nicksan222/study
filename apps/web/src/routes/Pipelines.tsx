import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/Pipelines')({
  staticData: { page: 'Pipelines' },
  component: () => null
});
