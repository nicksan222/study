import { test } from '@study/testing';

import type * as ProjectPageModule from './use-page.ts';

let usePage: typeof ProjectPageModule.usePage;

let project: string | undefined;

test.beforeEach(async ({ mock }) => {
  project = undefined;
  mock('@tanstack/react-router', () => ({ useSearch: () => ({ project }) }));
  ({ usePage } = await import('./use-page.ts'));
});

test.stable('preserves subject precision and clears the unselected workspace', () => {
  project = '9007199254740993';
  const { result, rerender } = test.renderHook(usePage);

  test.expect(result.current.project).toBe(9007199254740993n);
  project = undefined;
  rerender();
  test.expect(result.current.project).toBeUndefined();
});
