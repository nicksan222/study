import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/home')({
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/notes', search, replace: true });
  }
});
