import { test } from '@study/testing';
import {
  createMemoryHistory,
  stringifySearchWith,
  createRootRoute,
  createRouter,
  RouterProvider
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';

export function renderInRouter(children: ReactNode): ReturnType<typeof render> {
  const routeTree = createRootRoute({ component: () => children });
  const router = createRouter({
    stringifySearch: stringifySearchWith(String),
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] })
  });

  const view = render(<RouterProvider router={router} />);

  test.onTestFinished(() => {
    view.unmount();
    router.history.destroy();
  });

  return view;
}
