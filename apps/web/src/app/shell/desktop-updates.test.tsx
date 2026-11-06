import { testStable } from '@study/testing/vitest';
import { toastManager } from '@study/ui/toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, expect, vi } from 'vite-plus/test';

import { DesktopUpdates } from './desktop-updates';

const native = vi.hoisted(() => ({ enabled: true, invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => native.enabled, invoke: native.invoke }));
vi.mock('#web/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

beforeEach(() => {
  native.enabled = true;
  native.invoke.mockReset();
  vi.spyOn(toastManager, 'add').mockReturnValue('update-toast');
  vi.spyOn(toastManager, 'close').mockImplementation(() => {});
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <DesktopUpdates />
    </QueryClientProvider>
  );
}

testStable('does not call desktop commands in the browser', () => {
  native.enabled = false;
  mount();
  expect(native.invoke).not.toHaveBeenCalled();
});

testStable(
  'waits for consent before installing and offers retry after a failed install',
  async () => {
    native.invoke.mockResolvedValueOnce('0.1.42').mockRejectedValueOnce(new Error('offline'));
    mount();
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
    expect(native.invoke).toHaveBeenLastCalledWith('install_update');
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

testStable('keeps unavailable updates and offline checks quiet', async () => {
  native.invoke.mockResolvedValueOnce(null);
  const view = mount();

  await waitFor(() => expect(native.invoke).toHaveBeenCalledExactlyOnceWith('check_for_update'));
  expect(toastManager.add).not.toHaveBeenCalled();
  view.unmount();
  native.invoke.mockRejectedValueOnce(new Error('offline'));
  mount();
  await waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(2));
  expect(toastManager.add).not.toHaveBeenCalled();
});
