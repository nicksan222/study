/** @file Owns practice backup within this feature. */

import { contentInputSchema } from '@study/contracts';
import { Schema } from 'effect';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';

import { slots } from './practice-schemas.ts';

export const PracticeBackupStore = defineStore({
  name: 'study/PracticeBackupStore',
  entity: { singular: 'backupQuiescent', plural: 'backupPractices' },
  make: ({ db }) => ({
    queries: {
      backupQuiescent: storeQuery({
        role: 'required',
        input: Schema.Void,
        output: Schema.Boolean,
        run: () => {
          const ids = Schema.decodeUnknownSync(
            Schema.fromJsonString(Schema.toCodecJson(Schema.Array(contentInputSchema)))
          );

          for (const row of db.orm.select().from(slots).all()) ids(row.inputs);

          return true;
        }
      })
    },
    mutations: {}
  })
});
