import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/MediaList')({
  staticData: { page: 'MediaList' },
  component: () => null
});
