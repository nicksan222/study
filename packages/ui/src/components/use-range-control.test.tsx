import { test } from '@study/testing';

import { useRangeControl } from './use-range-control';

test.stable('restores the committed value after a failed save without resubmitting on blur', () => {
  const save = test.vi.fn();
  const { result, rerender } = test.renderHook(
    ({ disabled }) => useRangeControl(100, disabled, save),
    {
      initialProps: { disabled: false }
    }
  );

  test.act(() => result.current.setDraft(120));
  test.act(() => result.current.commit());
  test.expect(save).toHaveBeenCalledExactlyOnceWith(120);
  rerender({ disabled: true });
  test.expect(result.current.draft).toBe(120);
  rerender({ disabled: false });
  test.expect(result.current.draft).toBe(100);
  test.act(() => result.current.commit());
  test.expect(save).toHaveBeenCalledTimes(1);
});
