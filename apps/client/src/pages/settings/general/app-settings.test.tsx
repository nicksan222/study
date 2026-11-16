import { test } from '@study/testing';

import { useAppSettingsPatch } from './app-settings';

const saved = { language: 2 as const, appearance: 3 as const, zoomPercent: 125, onboarded: true };

test.stable(
  'partial appearance and language edits preserve freshly committed unrelated preferences',
  async ({ vi, rpcTestTransport, renderHook, act, expect }) => {
    const read = vi.fn().mockResolvedValue(saved);
    const write = vi.fn().mockResolvedValue({});
    const fixture = rpcTestTransport(async (tag, input) =>
      tag === 'settings.appSettings' ? read() : write(input)
    );
    const hook = renderHook(useAppSettingsPatch, { wrapper: fixture.wrapper });

    await act(async () => {
      await hook.result.current.mutateAsync({ appearance: 1 });
    });
    expect(write).toHaveBeenLastCalledWith({ ...saved, appearance: 1 });
    read.mockResolvedValue({ ...saved, zoomPercent: 150 });
    await act(async () => {
      await hook.result.current.mutateAsync({ language: 1 });
    });
    expect(write).toHaveBeenLastCalledWith({ ...saved, zoomPercent: 150, language: 1 });
  }
);

test.stable(
  'a failed freshness read never submits a guessed preference snapshot',
  async ({ vi, rpcTestTransport, renderHook, act, expect, waitFor }) => {
    const write = vi.fn();
    const fixture = rpcTestTransport(async (tag, input) => {
      if (tag === 'settings.appSettings') throw new Error('Offline');

      return write(input);
    });
    const hook = renderHook(useAppSettingsPatch, { wrapper: fixture.wrapper });

    await act(async () => {
      await expect(hook.result.current.mutateAsync({ zoomPercent: 150 })).rejects.toBeDefined();
    });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(write).not.toHaveBeenCalled();
  }
);
