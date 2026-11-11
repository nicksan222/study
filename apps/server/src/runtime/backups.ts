/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Composes public feature participants for isolated snapshot preparation and         │
 * │ restored content validation.                                                             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Injects owner sanitization, retirement, integrity checks and replacement policy into   │
 * │   storage.                                                                               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Features expose synchronous participants and never import runtime or another feature     │
 * │ private store.                                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { Db } from '@study/db';
import { Effect } from 'effect';

import { Auth } from '#server/features/auth/index';
import { Learning } from '#server/features/learning/index';
import { Materials } from '#server/features/materials/index';
import { Notes } from '#server/features/notes/index';
import { Pages } from '#server/features/pages/index';
import { Sources } from '#server/features/sources/index';
import { System } from '#server/features/system/index';
import { Themes } from '#server/features/themes/index';
import { Workflows } from '#server/features/workflows/index';
import type { SnapshotPolicy } from '#server/platform/database/backups';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction, transactionDatabase } from '#server/platform/definitions/define-store';

import { runNative } from './layers.ts';

function participate<A>(db: Db, operation: Effect.Effect<A, StudyError, Database>) {
  const context = new ServerContext(db);

  return runNative(operation.pipe(Effect.provideService(Database, { store: context })));
}

export const backupPolicy: SnapshotPolicy = {
  prepare: (db) =>
    participate(
      db,
      transaction((tx) => {
        Materials.prepareBackup(tx);
        const authoredRequests = Pages.prepareBackup(tx);

        Workflows.retireCorrelations(tx, authoredRequests, [
          'PageGenerationRequested',
          'PageGenerationFailed',
          'PagePublished'
        ]);
        Learning.prepareBackup(tx);
        Materials.validateBackup(tx);
        Pages.validateBackup(tx);
        Sources.validateBackup(tx);
        Notes.validateBackup(tx);
        Themes.validateBackup(tx);

        const captures = Notes.prepareBackup(tx);

        // Captures share reply request identities, even before a reply event exists.
        // Retain inspection while fencing every imported capture from actionable reuse.
        Workflows.retireCorrelations(tx, captures, ['NoteGenerationRequested']);
        Auth.sanitizeBackup(tx);
        Workflows.prepareBackup(tx);
      })
    ),
  validate: (db) =>
    participate(
      db,
      transaction((tx) => {
        Materials.validateBackup(tx);
        Pages.validateBackup(tx);
        Sources.validateBackup(tx);
        Notes.validateBackup(tx, true);
        Themes.validateBackup(tx);

        if (
          !Auth.validateBackup(tx) ||
          !Workflows.validateBackup(tx) ||
          !Learning.validateBackup(tx)
        )
          throw new StudyError('invalid_input', 'Backup contains live authority');
      })
    ),
  blocksRestore: System.backupRestoreBlocked,
  inspect: (db) =>
    participate(
      db,
      transaction((tx) => ({
        scope: System.backupScope(tx),
        identity: transactionDatabase(tx).contentIdentity()
      }))
    )
};
