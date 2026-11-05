import { testStable } from '@study/testing/vitest';
import { renderHook } from '@testing-library/react';
import { expect, vi } from 'vite-plus/test';

import { usePage } from './use-page';

const search = vi.hoisted(() => ({ project: undefined as string | undefined }));

vi.mock('@tanstack/react-router', () => ({ useSearch: () => search }));

testStable('preserves subject precision and clears the unselected workspace', () => {
  search.project = '9007199254740993';
  const { result, rerender } = renderHook(usePage);

  expect(result.current.project).toBe(9007199254740993n);
  search.project = undefined;
  rerender();
  expect(result.current.project).toBeUndefined();
});
