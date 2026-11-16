import { test } from '@study/testing';
import { toastManager } from '@study/ui';

import type * as __StudyMockType0 from '#client/app/shell/desktop-updates.tsx';

function createNative(mock: test.Mock) {
  return { enabled: true, invoke: mock.fn() };
}

let native: ReturnType<typeof createNative>;

let DesktopUpdates: typeof __StudyMockType0.DesktopUpdates;

test.beforeEach(async ({ mock }) => {
  native = createNative(mock);
  mock('#client/lib/host.ts', () => ({
    hostCapabilities: () => ({ updates: native.enabled, diagnostics: native.enabled }),
    desktopUpdateStatus: () => native.invoke('desktop_update_status'),
    checkDesktopUpdate: () => native.invoke('check_for_update'),
    installDesktopUpdate: (expectedVersion: string) =>
      native.invoke('install_update', { expectedVersion })
  }));
  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  const __studyMockModule0 = await import('./desktop-updates');

  DesktopUpdates = __studyMockModule0.DesktopUpdates;
});

test.beforeEach(({ vi }) => {
  native.enabled = true;
  native.invoke.mockReset();
  vi.spyOn(toastManager, 'add').mockReturnValue('update-toast');
  vi.spyOn(toastManager, 'close').mockImplementation(() => {});
});

function mount({ render }: Pick<test.Context, 'render'>) {
  return render(<DesktopUpdates />);
}

test.stable('does not call desktop commands in the browser', ({ expect, render }) => {
  native.enabled = false;
  mount({ render });
  expect(native.invoke).not.toHaveBeenCalled();
});

test.stable(
  'waits for consent before installing and offers retry after a failed install',
  async ({ waitFor, expect, vi, act, render }) => {
    native.invoke.mockResolvedValueOnce('0.1.42').mockRejectedValueOnce(new Error('offline'));
    mount({ render });
    await waitFor(() =>
      expect(toastManager.add).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'DesktopUpdateAvailable',
          timeout: 0
        })
      )
    );
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith('check_for_update');
    const prompt = vi.mocked(toastManager.add).mock.calls.at(-1)?.[0];

    await act(async () => {
      prompt?.actionProps?.onClick?.({} as never);
    });
    await waitFor(() =>
      expect(toastManager.add).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'DesktopUpdateFailed',
          actionProps: expect.objectContaining({ children: 'Retry' })
        })
      )
    );
    expect(native.invoke).toHaveBeenLastCalledWith('install_update', { expectedVersion: '0.1.42' });
    native.invoke.mockResolvedValueOnce(undefined);
    const retry = vi.mocked(toastManager.add).mock.calls.at(-1)?.[0];

    await act(async () => {
      retry?.actionProps?.onClick?.({} as never);
    });
    expect(
      native.invoke.mock.calls.filter(([command]) => command === 'install_update')
    ).toHaveLength(2);
  }
);

test.stable(
  'keeps unavailable updates and offline checks quiet',
  async ({ waitFor, expect, render }) => {
    native.invoke.mockResolvedValueOnce(null);
    const view = mount({ render });

    await waitFor(() => expect(native.invoke).toHaveBeenCalledExactlyOnceWith('check_for_update'));
    expect(toastManager.add).not.toHaveBeenCalled();
    view.unmount();
    native.invoke.mockRejectedValueOnce(new Error('offline'));
    mount({ render });
    await waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(2));
    expect(toastManager.add).not.toHaveBeenCalled();
  }
);
