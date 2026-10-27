import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/Sessions')({
  staticData: { page: 'Sessions' },
  component: () => null
});
