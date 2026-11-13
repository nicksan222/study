import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/notes')({
  staticData: { title: 'Notes', section: 'notes', scope: 'project' },
  component: Outlet
});
