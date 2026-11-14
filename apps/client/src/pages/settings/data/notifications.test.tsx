import { RegistryContext } from '@effect/atom-react';
import { testStable } from '@study/testing/vitest';
import { toastManager } from '@study/ui/toast';
import { act, render, waitFor } from '@testing-library/react';
import { AtomRegistry } from 'effect/reactivity';
import { expect, vi } from 'vite-plus/test';

import { dataOwner } from './data-owner.queries';
import { BackupNotifications } from './notifications';
vi.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@study/contracts/react', () => ({
  rpc: {
    system: {
      restoreStatus: { read: async () => ({ state: 'idle', backupId: null, recoveryCopy: true }) },
      listBackups: { read: async () => [] },
      discardRestoreRecovery: { call: async () => undefined }
    }
  }
}));
testStable(
  'announces only the confirmed operation and does not replay it on later discovery',
  async () => {
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
