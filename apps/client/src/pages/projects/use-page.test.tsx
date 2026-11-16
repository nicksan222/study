import { test } from '@study/testing';

import { usePage } from './use-page';

const search = test.hoisted(() => ({ project: undefined as string | undefined }));

test.mock('@tanstack/react-router', () => ({ useSearch: () => search }));

test.stable('preserves subject precision and clears the unselected workspace', () => {
  search.project = '9007199254740993';
  const { result, rerender } = test.renderHook(usePage);

  test.expect(result.current.project).toBe(9007199254740993n);
  search.project = undefined;
  rerender();
  test.expect(result.current.project).toBeUndefined();
});
