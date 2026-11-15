import { toastManager } from '@study/ui/toast';
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { useBackupOwner } from './data-owner.queries';

/** Announce confirmed operation receipts; transport errors never imply rollback. */
export function BackupNotifications() {
  const owner = useBackupOwner();
  const state = useSyncExternalStore(owner.subscribe, owner.snapshot, owner.snapshot);
  const seen = useRef(state.receipt);
  const { t } = useI18n();

  useEffect(() => {
    if (!state.receipt || seen.current === state.receipt || state.uncertain) return;

    seen.current = state.receipt;
    const labels = {
      create: 'DataBackupCreated',
      import: 'DataBackupImported',
      delete: 'DataBackupDeleted',
      accept: 'DataRestoreStaged',
      discard: 'DataRecoveryDiscarded'
    } as const;

    if (state.submitted)
      toastManager.add({ title: t(labels[state.submitted.kind]), type: 'success' });
  }, [state, t]);

  return null;
}
