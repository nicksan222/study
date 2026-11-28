/** @file Persists the local backup schedule, delivery cursor, and OneDrive authorization. */

import {
  automaticBackupFileDestinationSchema,
  backupIdSchema,
  MAX_AUTOMATIC_BACKUPS,
  errorKindSchema,
  backupOAuthConnectionSchema,
  storageBackupDestinationSchema
} from '@study/contracts';
import { preferences, sql } from '@study/db';
import { defineStore, storeMutation, storeQuery, transactionDatabase } from '@study/server';
import type { Transaction } from '@study/server';
import { Option, Schema } from 'effect';

import { writePreference } from './write-preference.ts';

const scope = 'private.automatic-backup';

const key = 'schedule';

const destination = Schema.Union([
  automaticBackupFileDestinationSchema,
  backupOAuthConnectionSchema,
  storageBackupDestinationSchema
]);

const automaticBackupState = Schema.Struct({
  destination: Schema.NullOr(destination),
  installation: backupIdSchema,
  nextSlot: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_AUTOMATIC_BACKUPS - 1 })),
  lastSuccessAtMs: Schema.NullOr(Schema.Int),
  lastFailure: Schema.NullOr(errorKindSchema),
  retryAtMs: Schema.Int,
  pendingObjectId: Schema.optionalKey(Schema.NonEmptyString)
});

export type AutomaticBackupState = typeof automaticBackupState.Type;

const decodeState = Schema.decodeUnknownSync(Schema.fromJsonString(automaticBackupState));

const match = sql`${preferences.scope} = ${scope}`;

export const AutomaticBackupStore = defineStore({
  name: 'study/AutomaticBackupStore',
  entity: { singular: 'automaticBackup', plural: 'automaticBackups' },
  make: ({ db }) => ({
    queries: {
      state: storeQuery({
        role: 'optional',
        input: Schema.Void,
        output: Schema.Option(automaticBackupState),
        run: () => {
          const row = db.orm
            .select({ value: preferences.value })
            .from(preferences)
            .where(sql`${match} AND ${preferences.key} = ${key}`)
            .get();

          return row ? Option.some(decodeState(row.value)) : Option.none();
        }
      })
    },
    mutations: {
      save: storeMutation({
        changes: ['system'],
        input: automaticBackupState,
        output: Schema.Void,
        run: (state) => writePreference(db, scope, key, JSON.stringify(state))
      })
    }
  })
});

export function sanitizeAutomaticBackup(tx: Transaction) {
  transactionDatabase(tx).orm.delete(preferences).where(match).run();
}

export function validateAutomaticBackup(tx: Transaction) {
  return !transactionDatabase(tx)
    .orm.select({ key: preferences.key })
    .from(preferences)
    .where(match)
    .get();
}
