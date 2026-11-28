/** @file Composes system application operations behind the feature boundary. */

import type { backupScopeSchema } from '@study/contracts';
import { defineService } from '@study/server';
import type { Transaction } from '@study/server';
import { Semaphore } from 'effect';

import { BackupScopeStore } from '#server/features/system/store/backup';

import { automaticBackupOperations } from './automatic-backups.ts';
import { systemBackupOperations } from './backups.ts';
import { systemOperations } from './system.ts';

export const System = defineService(
  'study/System',
  function* () {
    const backupLock = yield* Semaphore.make(1);

    return {
      ...(yield* systemBackupOperations(backupLock)),
      ...(yield* automaticBackupOperations(backupLock)),
      ...(yield* systemOperations())
    };
  },
  {
    backupScope: (tx: Transaction) => tx.store(BackupScopeStore).backupScope(undefined),
    backupRestoreBlocked: (scope: typeof backupScopeSchema.Type) =>
      scope.tombstones > 0 || scope.historyPrunes > 0
  }
);
