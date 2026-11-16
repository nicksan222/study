import { test } from '@study/testing';
import { toastManager } from '@study/ui';

import { DesktopUpdates } from './desktop-updates';

const native = test.hoisted(() => ({ enabled: true, invoke: test.vi.fn() }));

test.mock('#client/lib/host.ts', () => ({
  hostCapabilities: () => ({ updates: native.enabled, diagnostics: native.enabled }),
  desktopUpdateStatus: () => native.invoke('desktop_update_status'),
  checkDesktopUpdate: () => native.invoke('check_for_update'),
  installDesktopUpdate: (expectedVersion: string) =>
    native.invoke('install_update', { expectedVersion })
}));
test.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

test.beforeEach(() => {
  native.enabled = true;
  native.invoke.mockReset();
  test.vi.spyOn(toastManager, 'add').mockReturnValue('update-toast');
  test.vi.spyOn(toastManager, 'close').mockImplementation(() => {});
});

function mount() {
  return test.render(<DesktopUpdates />);
}

test.stable('does not call desktop commands in the browser', () => {
  native.enabled = false;
  mount();
  test.expect(native.invoke).not.toHaveBeenCalled();
});

test.stable(
  'waits for consent before installing and offers retry after a failed install',
  async () => {
    native.invoke.mockResolvedValueOnce('0.1.42').mockRejectedValueOnce(new Error('offline'));
    mount();
    await test.waitFor(() =>
      test.expect(toastManager.add).toHaveBeenCalledWith(
        test.expect.objectContaining({
          title: 'DesktopUpdateAvailable',
          timeout: 0
        })
      )
    );
    test.expect(native.invoke).toHaveBeenCalledExactlyOnceWith('check_for_update');
    const prompt = test.vi.mocked(toastManager.add).mock.calls.at(-1)?.[0];

    await test.act(async () => {
      prompt?.actionProps?.onClick?.({} as never);
    });
    await test.waitFor(() =>
      test.expect(toastManager.add).toHaveBeenCalledWith(
        test.expect.objectContaining({
          title: 'DesktopUpdateFailed',
          actionProps: test.expect.objectContaining({ children: 'Retry' })
        })
      )
    );
    test
      .expect(native.invoke)
      .toHaveBeenLastCalledWith('install_update', { expectedVersion: '0.1.42' });
    native.invoke.mockResolvedValueOnce(undefined);
    const retry = test.vi.mocked(toastManager.add).mock.calls.at(-1)?.[0];

    await test.act(async () => {
      retry?.actionProps?.onClick?.({} as never);
    });
    test
      .expect(native.invoke.mock.calls.filter(([command]) => command === 'install_update'))
      .toHaveLength(2);
  }
);

test.stable('keeps unavailable updates and offline checks quiet', async () => {
  native.invoke.mockResolvedValueOnce(null);
  const view = mount();

  await test.waitFor(() =>
    test.expect(native.invoke).toHaveBeenCalledExactlyOnceWith('check_for_update')
  );
  test.expect(toastManager.add).not.toHaveBeenCalled();
  view.unmount();
  native.invoke.mockRejectedValueOnce(new Error('offline'));
  mount();
  await test.waitFor(() => test.expect(native.invoke).toHaveBeenCalledTimes(2));
  test.expect(toastManager.add).not.toHaveBeenCalled();
});
