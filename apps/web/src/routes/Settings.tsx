import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/Settings')({
  staticData: { page: 'Settings' },
  component: () => null
});
