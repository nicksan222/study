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

function mount({ render }: Pick<test.Context, 'render'>) {
  return render(<UpdatesSettings />);
}

test.stable(
  'browser explains availability without invoking native commands',
  ({ expect, screen, render }) => {
    native.enabled = false;
    mount({ render });
    expect(
      screen.getByText('Updates are available in installed release builds.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check for updates' })).not.toBeInTheDocument();
    expect(native.invoke).not.toHaveBeenCalled();
  }
);

test.stable(
  'manual check reports current version only after a successful check',
  async ({ expect, screen, userEvent, render }) => {
    mount({ render });
    expect(await screen.findByText('0.1.1')).toBeInTheDocument();
    expect(screen.queryByText('Study is up to date.')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText('Study is up to date.')).toBeInTheDocument();
    expect(native.invoke).toHaveBeenCalledWith('check_for_update');
  }
);

test.stable(
  'unsigned desktop builds cannot claim to be current',
  async ({ expect, screen, render }) => {
    native.invoke.mockResolvedValue({ version: '0.1.1', supported: false });
    mount({ render });
    expect(
      await screen.findByText('Updates are available in installed release builds.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check for updates' })).not.toBeInTheDocument();
  }
);

test.stable(
  'retries a failed native capability query before enabling manual checks',
  async ({ expect, screen, userEvent, render }) => {
    native.invoke.mockRejectedValueOnce(new Error('connection unavailable'));
    mount({ render });
    expect(
      await screen.findByText('The update could not be completed. Try again.')
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Check for updates' })).toBeEnabled();
  }
);

test.stable(
  'check failure is recoverable and a new check clears the error',
  async ({ screen, userEvent, expect, render }) => {
    mount({ render });
    const button = await screen.findByRole('button', { name: 'Check for updates' });

    native.invoke.mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(button);
    expect(
      await screen.findByText('The update could not be completed. Try again.')
    ).toBeInTheDocument();
    native.invoke.mockResolvedValueOnce(null);
    await userEvent.click(button);
    expect(await screen.findByText('Study is up to date.')).toBeInTheDocument();
  }
);

test.stable(
  'requires install consent, disables duplicate actions, and retries a failed install',
  async ({ screen, userEvent, expect, act, waitFor, render }) => {
    mount({ render });
    const check = await screen.findByRole('button', { name: 'Check for updates' });

    native.invoke.mockResolvedValueOnce('0.1.42');
    await userEvent.click(check);
    const install = await screen.findByRole('button', { name: 'Install and restart' });

    expect(native.invoke).not.toHaveBeenCalledWith('install_update', expect.anything());
    let reject!: (error: Error) => void;

    native.invoke.mockReturnValueOnce(
      new Promise((_, fail) => {
        reject = fail;
      })
    );
    await userEvent.click(install);
    expect(install).toBeDisabled();
    expect(check).toBeDisabled();
    expect(native.invoke).toHaveBeenLastCalledWith('install_update', { expectedVersion: '0.1.42' });
    await act(async () => reject(new Error('offline')));
    expect(
      await screen.findByText('The update could not be completed. Try again.')
    ).toBeInTheDocument();
    await waitFor(() => expect(install).toBeEnabled());
    native.invoke.mockResolvedValueOnce(undefined);
    await userEvent.click(install);
    expect(
      native.invoke.mock.calls.filter(([command]) => command === 'install_update')
    ).toHaveLength(2);
  }
);

test.stable(
  'settings and background consent cannot start competing native installations',
  async ({ vi, render, userEvent, screen, waitFor, expect, act }) => {
    const notice = vi.spyOn(toastManager, 'add').mockReturnValue('update-notice');

    vi.spyOn(toastManager, 'close').mockImplementation(() => {});
    let finish: (() => void) | undefined;

    native.invoke.mockImplementation((command) => {
      if (command === 'desktop_update_status')
        return Promise.resolve({ version: '0.1.1', supported: true });

      if (command === 'check_for_update') return Promise.resolve('0.1.42');

      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    render(
      <RegistryProvider>
        <DesktopUpdates />
        <UpdatesSettings />
      </RegistryProvider>
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Install and restart' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    const consent = notice.mock.calls.find(([value]) => value.actionProps)?.[0];

    await act(async () => {
      consent?.actionProps?.onClick?.({} as never);
    });
    expect(
      native.invoke.mock.calls.filter(([command]) => command === 'install_update')
    ).toHaveLength(1);
    await act(async () => {
      finish?.();
    });
  }
);
