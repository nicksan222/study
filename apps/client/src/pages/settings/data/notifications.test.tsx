import { RegistryContext } from '@effect/atom-react';
import { test } from '@study/testing';
import { toastManager } from '@study/ui';
import { AtomRegistry } from 'effect/reactivity';

import { dataOwner } from './data-owner.queries';
import { BackupNotifications } from './notifications';
test.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
test.mock('@study/contracts/react', () => ({
  rpc: {
    system: {
      restoreStatus: { read: async () => ({ state: 'idle', backupId: null, recoveryCopy: true }) },
      listBackups: { read: async () => [] },
      discardRestoreRecovery: { call: async () => undefined }
    }
  }
}));
test.stable(
  'announces only the confirmed operation and does not replay it on later discovery',
  async () => {
    const registry = AtomRegistry.make();
    const owner = dataOwner(registry);
    const toast = test.vi.spyOn(toastManager, 'add').mockReturnValue('receipt');

    test.render(
      <RegistryContext.Provider value={registry}>
        <BackupNotifications />
      </RegistryContext.Provider>
    );
    await test.act(async () => {
      await owner.refresh();
      await owner.discard();
    });
    await test.waitFor(() =>
      test.expect(toast).toHaveBeenCalledExactlyOnceWith({
        title: 'DataRecoveryDiscarded',
        type: 'success'
      })
    );
    await test.act(async () => {
      await owner.refresh();
    });
    test.expect(toast).toHaveBeenCalledTimes(1);
    registry.dispose();
  }
);
