/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Combines health and search stores with worker lifecycle controls for the system    │
 * │ service.                                                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Feature services own application rules and coordinate typed store operations.          │
 * │ - Validates or coordinates feature-level operations.                                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses owned stores and platform transactions rather than querying SQLite directly.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type {
  BackupId,
  acceptRestoreSchema,
  backupScopeSchema
} from '@study/contracts/system/backups';
import type { searchInputSchema, materialSearchInputSchema } from '@study/contracts/system/rpc';
import { Effect } from 'effect';

import { BackupScopeStore } from '#server/features/system/store/backup';
import { HealthStore, SystemStore } from '#server/features/system/store/index';
import type { ManagedBackups } from '#server/platform/database/backups';
import { BackupStorage } from '#server/platform/database/backups';
import { defineService } from '#server/platform/definitions/define-service';
import { useStore } from '#server/platform/definitions/define-store';
import type { Transaction } from '#server/platform/definitions/define-store';
import { normalizeError } from '#server/platform/errors/classify-error';
import { WorkerLifecycle } from '#server/platform/workflows/lifecycle';

import { healthData } from './health.ts';

export const System = defineService(
  'study/System',
  Effect.gen(function* () {
    const workers = yield* WorkerLifecycle;

    const storage = yield* BackupStorage;

    const backups: ManagedBackups = storage.owner;

    const backupOperation = <A>(tryOperation: () => Promise<A>) =>
      Effect.tryPromise({ try: tryOperation, catch: normalizeError });

    const store = yield* useStore(SystemStore);

    const health = yield* useStore(HealthStore);

    return {
      createBackup: () => backupOperation(() => backups.create()),
      backups: () => backupOperation(() => backups.list()),
      readBackup: (input: { id: BackupId }) => backupOperation(() => backups.read(input.id)),
      importBackup: (input: { bytes: string }) =>
        backupOperation(() => backups.import(input.bytes)),
      deleteBackup: (input: { id: BackupId }) => backupOperation(() => backups.delete(input.id)),
      previewRestore: (input: { id: BackupId }) =>
        backupOperation(() => backups.previewRestore(input.id)),
      acceptRestore: (input: typeof acceptRestoreSchema.Type) =>
        backupOperation(() => backups.accept(input)),
      restoreStatus: () => backupOperation(() => backups.status()),
      discardRestoreRecovery: () => backupOperation(() => backups.discardRecovery()),
      health: () =>
        health.health(undefined).pipe(
          Effect.flatMap(() => workers.started),
          Effect.map(healthData)
        ),
      materialSearch: (input: typeof materialSearchInputSchema.Type) =>
        store.searches({ ...input, kinds: ['material'] }).pipe(
          Effect.map((hits) => ({
            semantic: false as const,
            hits: hits.flatMap((hit) =>
              hit.target.type === 'material'
                ? [{ ...hit, kind: 'material' as const, target: hit.target }]
                : []
            )
          }))
        ),
      search: (input: typeof searchInputSchema.Type) =>
        store.searches(input).pipe(Effect.map((hits) => ({ semantic: false, hits }))),
      startWorkers: () => workers.start,
      stopWorkers: () => workers.stop
    };
  }),
  {
    backupScope: (tx: Transaction) => tx.store(BackupScopeStore).backupScope(undefined),
    backupRestoreBlocked: (scope: typeof backupScopeSchema.Type) =>
      scope.tombstones > 0 || scope.historyPrunes > 0
  }
);
