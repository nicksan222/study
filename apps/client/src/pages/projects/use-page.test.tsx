import { test } from '@study/testing';

import type * as ProjectPageModule from './use-page.ts';

let usePage: typeof ProjectPageModule.usePage;

let project: string | undefined;

test.unit.beforeEach(async ({ mock }) => {
  project = undefined;
  mock('@tanstack/react-router', () => ({ useSearch: () => ({ project }) }));
  ({ usePage } = await import('./use-page.ts'));
});

test.unit.stable(
  'preserves subject precision and clears the unselected workspace',
  ({ renderHook, expect }) => {
    project = '9007199254740993';
    const { result, rerender } = renderHook(usePage);

    expect(result.current.project).toBe(9007199254740993n);
    project = undefined;
    rerender();
    expect(result.current.project).toBeUndefined();
  }
);
