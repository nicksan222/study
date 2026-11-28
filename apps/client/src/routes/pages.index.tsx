import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/pages/')({
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/practice', search, replace: true });
  }
});
