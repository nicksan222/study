import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vite-plus/test';

import { useRangeControl } from './use-range-control';

it('restores the committed value after a failed save without resubmitting on blur', () => {
  const save = vi.fn();
  const { result, rerender } = renderHook(({ disabled }) => useRangeControl(100, disabled, save), {
    initialProps: { disabled: false }
  });

  act(() => result.current.setDraft(120));
  act(() => result.current.commit());
  expect(save).toHaveBeenCalledExactlyOnceWith(120);
  rerender({ disabled: true });
  expect(result.current.draft).toBe(120);
  rerender({ disabled: false });
  expect(result.current.draft).toBe(100);
  act(() => result.current.commit());
  expect(save).toHaveBeenCalledTimes(1);
});
