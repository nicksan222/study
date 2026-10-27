import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/Projects')({
  staticData: { page: 'Projects' },
  component: () => null
});
