import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/Help')({
  staticData: { page: 'Help' },
  component: () => null
});
