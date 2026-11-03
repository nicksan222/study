import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/sessions')({
  staticData: { title: 'Sessions', section: 'sessions', scope: 'project' },
  component: Outlet
});
