import { test } from '@study/testing';

import { useAppSettingsPatch } from './app-settings';

const saved = { language: 2 as const, appearance: 3 as const, zoomPercent: 125, onboarded: true };

test.stable(
  'partial appearance and language edits preserve freshly committed unrelated preferences',
  async () => {
    const read = test.vi.fn().mockResolvedValue(saved);
    const write = test.vi.fn().mockResolvedValue({});
    const fixture = test.rpcTestTransport(async (tag, input) =>
      tag === 'settings.appSettings' ? read() : write(input)
    );
    const hook = test.renderHook(useAppSettingsPatch, { wrapper: fixture.wrapper });

    await test.act(async () => {
      await hook.result.current.mutateAsync({ appearance: 1 });
    });
    test.expect(write).toHaveBeenLastCalledWith({ ...saved, appearance: 1 });
    read.mockResolvedValue({ ...saved, zoomPercent: 150 });
    await test.act(async () => {
      await hook.result.current.mutateAsync({ language: 1 });
    });
    test.expect(write).toHaveBeenLastCalledWith({ ...saved, zoomPercent: 150, language: 1 });
  }
);

test.stable('a failed freshness read never submits a guessed preference snapshot', async () => {
  const write = test.vi.fn();
  const fixture = test.rpcTestTransport(async (tag, input) => {
    if (tag === 'settings.appSettings') throw new Error('Offline');

    return write(input);
  });
  const hook = test.renderHook(useAppSettingsPatch, { wrapper: fixture.wrapper });

  await test.act(async () => {
    await test.expect(hook.result.current.mutateAsync({ zoomPercent: 150 })).rejects.toBeDefined();
  });
  await test.waitFor(() => test.expect(hook.result.current.isError).toBe(true));
  test.expect(write).not.toHaveBeenCalled();
});
