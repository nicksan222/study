/** @file Owns backups within this feature. */

import type { BackupId, acceptRestoreSchema } from '@study/contracts';
import { BackupStorage, normalizeError } from '@study/server';
import type { ManagedBackups } from '@study/server';
import { Effect } from 'effect';
import type { Semaphore } from 'effect';

export function* systemBackupOperations(backupLock: Semaphore.Semaphore) {
  const storage = yield* BackupStorage;

  const backups: ManagedBackups = storage.owner;

  const backupOperation = <A>(tryOperation: () => Promise<A>) =>
    Effect.tryPromise({ try: tryOperation, catch: normalizeError });

  function acceptRestore(input: typeof acceptRestoreSchema.Type) {
    return backupLock.withPermit(
      Effect.suspend(() => {
        let acceptance: ReturnType<ManagedBackups['accept']> | undefined;

        // Native acceptance owns the staged files until its promise settles.
        return backupOperation(() => (acceptance = backups.accept(input))).pipe(
          Effect.onInterrupt(() => {
            const pending = acceptance;

            return pending
              ? backupOperation(() => pending).pipe(Effect.exit, Effect.asVoid)
              : Effect.void;
          })
        );
      })
    );
  }

  return {
    createBackup: () => backupOperation(() => backups.create()),
    backups: () => backupOperation(() => backups.list()),
    readBackup: (input: { id: BackupId }) => backupOperation(() => backups.read(input.id)),
    importBackup: (input: { bytes: string }) => backupOperation(() => backups.import(input.bytes)),
    deleteBackup: (input: { id: BackupId }) => backupOperation(() => backups.delete(input.id)),
    previewRestore: (input: { id: BackupId }) =>
      backupOperation(() => backups.previewRestore(input.id)),
    acceptRestore,
    restoreStatus: () => backupOperation(() => backups.status()),
    discardRestoreRecovery: () => backupOperation(() => backups.discardRecovery())
  };
}
