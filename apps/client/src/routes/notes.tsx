import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/notes')({
  staticData: { title: 'Documents', section: 'notes', scope: 'project' },
  component: Outlet
});
