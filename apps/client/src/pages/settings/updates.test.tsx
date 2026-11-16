import { RegistryProvider } from '@effect/atom-react';
import { test } from '@study/testing';
import { toastManager } from '@study/ui';

import type * as __StudyMockType0 from '#client/app/shell/desktop-updates.tsx';
import type * as __StudyMockType1 from '#client/pages/settings/updates.tsx';

function createNative(mock: test.Mock) {
  return { enabled: true, invoke: mock.fn() };
}

let native: ReturnType<typeof createNative>;

let DesktopUpdates: typeof __StudyMockType0.DesktopUpdates;

let UpdatesSettings: typeof __StudyMockType1.UpdatesSettings;

test.beforeEach(async ({ mock }) => {
  native = createNative(mock);
  mock('#client/lib/host.ts', () => ({
    hostCapabilities: () => ({ updates: native.enabled, diagnostics: native.enabled }),
    desktopUpdateStatus: () => native.invoke('desktop_update_status'),
    checkDesktopUpdate: () => native.invoke('check_for_update'),
    installDesktopUpdate: (expectedVersion: string) =>
      native.invoke('install_update', { expectedVersion })
  }));
  const __studyMockModule0 = await import('#client/app/shell/desktop-updates.tsx');

  DesktopUpdates = __studyMockModule0.DesktopUpdates;
  const __studyMockModule1 = await import('./updates');

  UpdatesSettings = __studyMockModule1.UpdatesSettings;
});

test.beforeEach(() => {
  native.enabled = true;
  native.invoke.mockReset().mockImplementation((command) => {
    if (command === 'desktop_update_status')
      return Promise.resolve({ version: '0.1.1', supported: true });

    return Promise.resolve(null);
  });
});

function mount() {
  return test.render(<UpdatesSettings />);
}

test.stable('browser explains availability without invoking native commands', () => {
  native.enabled = false;
  mount();
  test
    .expect(test.screen.getByText('Updates are available in installed release builds.'))
    .toBeInTheDocument();
  test
    .expect(test.screen.queryByRole('button', { name: 'Check for updates' }))
    .not.toBeInTheDocument();
  test.expect(native.invoke).not.toHaveBeenCalled();
});

test.stable('manual check reports current version only after a successful check', async () => {
  mount();
  test.expect(await test.screen.findByText('0.1.1')).toBeInTheDocument();
  test.expect(test.screen.queryByText('Study is up to date.')).not.toBeInTheDocument();
  await test.userEvent.click(await test.screen.findByRole('button', { name: 'Check for updates' }));
  test.expect(await test.screen.findByText('Study is up to date.')).toBeInTheDocument();
  test.expect(native.invoke).toHaveBeenCalledWith('check_for_update');
});

test.stable('unsigned desktop builds cannot claim to be current', async () => {
  native.invoke.mockResolvedValue({ version: '0.1.1', supported: false });
  mount();
  test
    .expect(await test.screen.findByText('Updates are available in installed release builds.'))
    .toBeInTheDocument();
  test
    .expect(test.screen.queryByRole('button', { name: 'Check for updates' }))
    .not.toBeInTheDocument();
});

test.stable('retries a failed native capability query before enabling manual checks', async () => {
  native.invoke.mockRejectedValueOnce(new Error('connection unavailable'));
  mount();
  test
    .expect(await test.screen.findByText('The update could not be completed. Try again.'))
    .toBeInTheDocument();
  await test.userEvent.click(test.screen.getByRole('button', { name: 'Retry' }));
  test.expect(await test.screen.findByRole('button', { name: 'Check for updates' })).toBeEnabled();
});

test.stable('check failure is recoverable and a new check clears the error', async () => {
  mount();
  const button = await test.screen.findByRole('button', { name: 'Check for updates' });

  native.invoke.mockRejectedValueOnce(new Error('offline'));
  await test.userEvent.click(button);
  test
    .expect(await test.screen.findByText('The update could not be completed. Try again.'))
    .toBeInTheDocument();
  native.invoke.mockResolvedValueOnce(null);
  await test.userEvent.click(button);
  test.expect(await test.screen.findByText('Study is up to date.')).toBeInTheDocument();
});

test.stable(
  'requires install consent, disables duplicate actions, and retries a failed install',
  async () => {
    mount();
    const check = await test.screen.findByRole('button', { name: 'Check for updates' });

    native.invoke.mockResolvedValueOnce('0.1.42');
    await test.userEvent.click(check);
    const install = await test.screen.findByRole('button', { name: 'Install and restart' });

    test.expect(native.invoke).not.toHaveBeenCalledWith('install_update', test.expect.anything());
    let reject!: (error: Error) => void;

    native.invoke.mockReturnValueOnce(
      new Promise((_, fail) => {
        reject = fail;
      })
    );
    await test.userEvent.click(install);
    test.expect(install).toBeDisabled();
    test.expect(check).toBeDisabled();
    test
      .expect(native.invoke)
      .toHaveBeenLastCalledWith('install_update', { expectedVersion: '0.1.42' });
    await test.act(async () => reject(new Error('offline')));
    test
      .expect(await test.screen.findByText('The update could not be completed. Try again.'))
      .toBeInTheDocument();
    await test.waitFor(() => test.expect(install).toBeEnabled());
    native.invoke.mockResolvedValueOnce(undefined);
    await test.userEvent.click(install);
    test
      .expect(native.invoke.mock.calls.filter(([command]) => command === 'install_update'))
      .toHaveLength(2);
  }
);

test.stable(
  'settings and background consent cannot start competing native installations',
  async () => {
    const notice = test.vi.spyOn(toastManager, 'add').mockReturnValue('update-notice');

    test.vi.spyOn(toastManager, 'close').mockImplementation(() => {});
    let finish: (() => void) | undefined;

    native.invoke.mockImplementation((command) => {
      if (command === 'desktop_update_status')
        return Promise.resolve({ version: '0.1.1', supported: true });

      if (command === 'check_for_update') return Promise.resolve('0.1.42');

      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    test.render(
      <RegistryProvider>
        <DesktopUpdates />
        <UpdatesSettings />
      </RegistryProvider>
    );
    await test.userEvent.click(
      await test.screen.findByRole('button', { name: 'Check for updates' })
    );
    await test.userEvent.click(
      await test.screen.findByRole('button', { name: 'Install and restart' })
    );
    await test.waitFor(() => test.expect(finish).toBeTypeOf('function'));
    const consent = notice.mock.calls.find(([value]) => value.actionProps)?.[0];

    await test.act(async () => {
      consent?.actionProps?.onClick?.({} as never);
    });
    test
      .expect(native.invoke.mock.calls.filter(([command]) => command === 'install_update'))
      .toHaveLength(1);
    await test.act(async () => {
      finish?.();
    });
  }
);
