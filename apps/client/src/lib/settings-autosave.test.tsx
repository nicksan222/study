import { test } from '@study/testing';

import { useSettingsAutosave } from './settings-autosave';

test.unit.stable(
  'uses the committed writer when an outstanding settings read finishes',
  async ({ renderHook, act, expect, vi }) => {
    const read = Promise.withResolvers<{ unchanged: number; changed: number }>();
    const oldWrite = vi.fn().mockRejectedValue(new Error('Old writer unavailable'));
    const newWrite = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ writer }) => useSettingsAutosave(() => read.promise, writer),
      { initialProps: { writer: oldWrite } }
    );

    act(() => result.current.update({ changed: 3 }));
    expect(result.current.pending).toBe(true);
    rerender({ writer: newWrite });
    await act(async () => read.resolve({ unchanged: 1, changed: 2 }));

    expect(oldWrite).not.toHaveBeenCalled();
    expect(newWrite).toHaveBeenCalledExactlyOnceWith({ unchanged: 1, changed: 3 });
    expect(result.current.error).toBe(false);
  }
);
