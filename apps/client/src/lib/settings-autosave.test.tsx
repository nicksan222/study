import { test } from '@study/testing';

import { useSettingsAutosave, useSettingsPatchAutosave } from './settings-autosave';

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

test.unit.stable(
  'saves a new field independently and only replays failed edits on Retry',
  async ({ renderHook, act, expect, vi }) => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error('Save unavailable'))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSettingsPatchAutosave<{ chunkSeconds: number; denoise: boolean }>(write)
    );

    await act(async () => result.current.update({ denoise: true }));
    expect(result.current.error).toBe(true);

    await act(async () => result.current.update({ chunkSeconds: 20 }));
    expect(write.mock.calls).toEqual([[{ denoise: true }], [{ chunkSeconds: 20 }]]);
    expect(result.current.error).toBe(true);

    await act(async () => result.current.retry());
    expect(write).toHaveBeenLastCalledWith({ denoise: true });
    expect(result.current.error).toBe(false);
  }
);

test.unit.stable(
  'drops a failed edit when a newer edit changes the same setting',
  async ({ renderHook, act, expect, vi }) => {
    const first = Promise.withResolvers<void>();
    const write = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSettingsPatchAutosave<{ chunkSeconds: number; denoise: boolean }>(write)
    );

    act(() => result.current.update({ denoise: true, chunkSeconds: 20 }));
    act(() => result.current.update({ chunkSeconds: 10 }));
    await act(async () => first.reject(new Error('Save unavailable')));

    expect(write).toHaveBeenLastCalledWith({ chunkSeconds: 10 });
    expect(result.current.error).toBe(true);
    await act(async () => result.current.retry());
    expect(write).toHaveBeenLastCalledWith({ denoise: true });
    expect(result.current.error).toBe(false);
  }
);
