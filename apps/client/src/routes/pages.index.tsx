import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/pages/')({
  staticData: { title: 'Documents', section: 'pages', scope: 'project' },
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/notes', search, replace: true });
  }
});
