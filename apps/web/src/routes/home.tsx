import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/home')({
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/sessions', search, replace: true });
  }
});
