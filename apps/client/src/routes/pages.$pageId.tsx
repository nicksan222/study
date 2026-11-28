import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/pages/$pageId')({
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: '/practice/study-notes/$pageId', params, search, replace: true });
  }
});
