import {
  acceptRestoreSchema,
  backupManifestSchema,
  restoreStatusSchema
} from '@study/contracts/system/backups';
import { toastManager } from '@study/ui/toast';
import { useQueryClient } from '@tanstack/react-query';
import { Schema } from 'effect';
import { useEffect } from 'react';

import { useI18n } from '../../../lib/i18n';
import { backupMutationKeys } from './data.queries';

const manifestReceived = (data: unknown) => Schema.is(backupManifestSchema)(data);

const deletionCommitted = (data: unknown) => data === undefined;

const restoreStaged = (data: unknown, variables: unknown) =>
  Schema.is(restoreStatusSchema)(data) &&
  data.state === 'restart-required' &&
  Schema.is(acceptRestoreSchema)(variables) &&
  data.backupId === variables.backupId;

const feedback = [
  { key: backupMutationKeys.create, label: 'DataBackupCreated', committed: manifestReceived },
  { key: backupMutationKeys.import, label: 'DataBackupImported', committed: manifestReceived },
  { key: backupMutationKeys.delete, label: 'DataBackupDeleted', committed: deletionCommitted },
  { key: backupMutationKeys.accept, label: 'DataRestoreStaged', committed: restoreStaged },
  { key: backupMutationKeys.discard, label: 'DataRecoveryDiscarded', committed: deletionCommitted }
] as const;

export function BackupNotifications() {
  const client = useQueryClient();
  const { t } = useI18n();

  useEffect(
    () =>
      client.getMutationCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'success') return;

        const key = event.mutation.options.mutationKey;
        const confirmed = feedbackFor(key);

        if (confirmed?.committed(event.action.data, event.mutation.state.variables)) {
          toastManager.add({ title: t(confirmed.label), type: 'success' });
        }
      }),
    [client, t]
  );

  return null;
}

/** Match every mutation key part so unrelated successes never emit backup feedback. */
function feedbackFor(key: readonly unknown[] | undefined) {
  return feedback.find(
    (item) =>
      key?.length === item.key.length && item.key.every((part, index) => part === key[index])
  );
}
