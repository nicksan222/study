import { StudyError } from '@study/contracts';
import { configureRpcTransport } from '@study/contracts/react';
import { catalogs, createLocalization } from '@study/localization';
import { test } from '@study/testing';

import type * as BackupSettings from './automatic-backups.tsx';

let AutomaticBackups: typeof BackupSettings.AutomaticBackups;

test.unit.beforeEach(async ({ mock }) => {
  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => createLocalization('english') }));
  const module = await import('./automatic-backups.tsx');

  AutomaticBackups = module.AutomaticBackups;
});

test.unit.stable(
  'cancelling cloud backup sign-in does not show an error when finish rejects before cancel returns',
  async ({ expect, vi, render, screen, fireEvent, act, waitFor, rpcTestTransport }) => {
    const copy = catalogs.english;
    const finishStarted = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const cancelStarted = Promise.withResolvers<void>();
    const cancel = Promise.withResolvers<void>();
    const popup = { location: { replace: vi.fn() }, close: vi.fn(), closed: false };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const fixture = rpcTestTransport(async (tag) => {
      switch (tag) {
        case 'system.automaticBackup':
          return { destination: 'onedrive', path: null, lastSuccessAtMs: null, lastFailure: null };
        case 'system.beginBackupSignIn':
          return { id: '11111111-1111-4111-8111-111111111111', url: 'https://login.example.test' };
        case 'system.finishBackupSignIn':
          finishStarted.resolve();

          return finish.promise;
        case 'system.cancelBackupSignIn':
          cancelStarted.resolve();

          return cancel.promise;
        default:
          throw new Error(`Unexpected RPC: ${tag}`);
      }
    });

    try {
      configureRpcTransport(fixture.transport);
      render(<AutomaticBackups mutable />, { wrapper: fixture.wrapper });
      fireEvent.click(await screen.findByRole('button', { name: copy.DataAutoBackupChange }));
      fireEvent.change(screen.getByRole('textbox', { name: copy.DataAutoBackupClientId }), {
        target: { value: '323ba9ad-5cf6-4fcc-8991-73f0bc3bfd76' }
      });
      fireEvent.click(screen.getByRole('button', { name: copy.DataAutoBackupReconnect }));
      await finishStarted.promise;
      fireEvent.click(await screen.findByRole('button', { name: copy.AiSettingsCancelSignIn }));
      await cancelStarted.promise;
      await act(async () => finish.reject(new StudyError('cancelled', 'Sign-in cancelled')));
      await act(async () => cancel.resolve());
      await waitFor(() => expect(popup.close).toHaveBeenCalled());
      expect(
        await screen.findByRole('button', { name: copy.DataAutoBackupReconnect })
      ).toBeEnabled();
      expect(screen.queryByText(copy.DataAutoBackupSignInFailed)).not.toBeInTheDocument();
    } finally {
      finish.resolve();
      cancel.resolve();
      open.mockRestore();
    }
  }
);
