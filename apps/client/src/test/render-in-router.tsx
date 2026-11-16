import {
  createMemoryHistory,
  stringifySearchWith,
  createRootRoute,
  createRouter,
  RouterProvider
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';

export function createRenderInRouter(onCleanup: (cleanup: () => void) => void) {
  const cleanups = new Set<() => void>();

  onCleanup(() => {
    for (const cleanup of cleanups) cleanup();
  });

  return function renderInRouter(children: ReactNode): ReturnType<typeof render> {
    const routeTree = createRootRoute({ component: () => children });
    const router = createRouter({
      stringifySearch: stringifySearchWith(String),
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/'] })
    });
    const view = render(<RouterProvider router={router} />);

    cleanups.add(() => {
      view.unmount();
      router.history.destroy();
    });

    return view;
  };
}
