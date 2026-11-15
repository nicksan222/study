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
import { Materials } from '#server/features/materials/index';
import { Notes } from '#server/features/notes/index';
import { Pages } from '#server/features/pages/index';
import { Sources } from '#server/features/sources/index';
import { System } from '#server/features/system/index';
import { Themes } from '#server/features/themes/index';
import type { SnapshotPolicy } from '#server/platform/database/backups';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction, transactionDatabase } from '#server/platform/definitions/define-store';
import type { Transaction } from '#server/platform/definitions/define-store';

import { runNative } from './layers.ts';
import './database.ts';

function participate<A>(db: Db, operation: Effect.Effect<A, StudyError, Database>) {
  const context = new ServerContext(db);

  return runNative(operation.pipe(Effect.provideService(Database, { store: context })));
}

function validateContent(tx: Transaction) {
  Materials.validateBackup(tx);
  Pages.validateBackup(tx);
  Sources.validateBackup(tx);
  Notes.validateBackup(tx);
  Themes.validateBackup(tx);
}

export const backupPolicy: SnapshotPolicy = {
  prepare: (db) =>
    participate(
      db,
      transaction((tx) => {
        validateContent(tx);
        // Retain all admitted work and its execution persistence in the same snapshot.
        Auth.sanitizeBackup(tx);
      })
    ),
  validate: (db) =>
    participate(
      db,
      transaction((tx) => {
        validateContent(tx);

        if (!Auth.validateBackup(tx))
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
