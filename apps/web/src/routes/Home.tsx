import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/Home')({
  staticData: { page: 'Home' },
  component: () => null
});
