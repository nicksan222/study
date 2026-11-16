import { RegistryContext } from '@effect/atom-react';
import { test } from '@study/testing';
import { toastManager } from '@study/ui';
import { AtomRegistry } from 'effect/reactivity';

import type * as __StudyMockType0 from '#client/pages/settings/data/data-owner.queries.ts';
import type * as __StudyMockType1 from '#client/pages/settings/data/notifications.tsx';

let dataOwner: typeof __StudyMockType0.dataOwner;

let BackupNotifications: typeof __StudyMockType1.BackupNotifications;

test.unit.beforeEach(async ({ mock }) => {
  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  mock('@study/contracts/react', () => ({
    rpc: {
      system: {
        restoreStatus: {
          read: async () => ({ state: 'idle', backupId: null, recoveryCopy: true })
        },
        listBackups: { read: async () => [] },
        discardRestoreRecovery: { call: async () => undefined }
      }
    }
  }));
  const __studyMockModule0 = await import('./data-owner.queries');

  dataOwner = __studyMockModule0.dataOwner;
  const __studyMockModule1 = await import('./notifications');

  BackupNotifications = __studyMockModule1.BackupNotifications;
});

test.unit.stable(
  'announces only the confirmed operation and does not replay it on later discovery',
  async ({ vi, render, act, waitFor, expect }) => {
    const registry = AtomRegistry.make();
    const owner = dataOwner(registry);
    const toast = vi.spyOn(toastManager, 'add').mockReturnValue('receipt');

    render(
      <RegistryContext.Provider value={registry}>
        <BackupNotifications />
      </RegistryContext.Provider>
    );
    await act(async () => {
      await owner.refresh();
      await owner.discard();
    });
    await waitFor(() =>
      expect(toast).toHaveBeenCalledExactlyOnceWith({
        title: 'DataRecoveryDiscarded',
        type: 'success'
      })
    );
    await act(async () => {
      await owner.refresh();
    });
    expect(toast).toHaveBeenCalledTimes(1);
    registry.dispose();
  }
);
