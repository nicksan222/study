/** @file Builds auth backup queries and mutations with bound store resources. */

import { preferences, sql } from '@study/db';
import { storeQuery } from '@study/server';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

import { scope } from './account.ts';
import { providerScope } from './scopes.ts';

export function makeAuthBackupStore({ db }: StoreResources) {
  return {
    queries: {
      backupSanitized: storeQuery({
        role: 'required',
        input: Schema.Void,
        output: Schema.Boolean,
        run: () =>
          !db.orm
            .select()
            .from(preferences)
            .where(sql`${preferences.scope} IN (${scope}, ${providerScope})`)
            .get()
      })
    },
    mutations: {}
  };
}
