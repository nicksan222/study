import { test } from '@study/testing';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider
} from '@tanstack/react-router';

import { usePage } from './use-page';

function Subject() {
  return <output>{String(usePage().project ?? '')}</output>;
}

test.unit.stable('reads the active subject as a project ID', async ({ render, screen, expect }) => {
  const route = createRootRoute({
    validateSearch: (search): { project?: string } =>
      typeof search.project === 'string' || typeof search.project === 'number'
        ? { project: String(search.project) }
        : {},
    component: Subject
  });
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/?project=42'] })
  });

  render(<RouterProvider router={router} />);

  expect(await screen.findByText('42')).toBeInTheDocument();
});
