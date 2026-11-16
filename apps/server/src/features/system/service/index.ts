/** @file Composes system application operations behind the feature boundary. */

import type { backupScopeSchema } from '@study/contracts';
import { defineService } from '@study/server';
import type { Transaction } from '@study/server';

import { BackupScopeStore } from '#server/features/system/store/backup';

import { systemBackupOperations } from './backups.ts';
import { systemOperations } from './system.ts';

export const System = defineService(
  'study/System',
  function* () {
    return {
      ...(yield* systemBackupOperations()),
      ...(yield* systemOperations())
    };
  },
  {
    backupScope: (tx: Transaction) => tx.store(BackupScopeStore).backupScope(undefined),
    backupRestoreBlocked: (scope: typeof backupScopeSchema.Type) =>
      scope.tombstones > 0 || scope.historyPrunes > 0
  }
);
