import {
  createMemoryHistory,
  stringifySearchWith,
  createRootRoute,
  createRouter,
  RouterProvider
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';

export function renderInRouter(children: ReactNode) {
  const routeTree = createRootRoute({ component: () => children });
  const router = createRouter({
    stringifySearch: stringifySearchWith(String),
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] })
  });

  return render(<RouterProvider router={router} />);
}
