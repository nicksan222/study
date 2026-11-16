/** @file Owns api keys within this feature. */

import { preferences, sql } from '@study/db';
import { storeMutation, storeQuery } from '@study/server';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

import { makeHelpers } from './account.ts';
import { providerScope } from './scopes.ts';

/** Private provider credentials share the account's durable generation fence. */
export function makeApiKeyStore({ db, clock, timestampClock }: StoreResources) {
  const { replaceGeneration } = makeHelpers({ db, clock, timestampClock });

  return {
    queries: {
      apiKeys: storeQuery({
        role: 'required',
        input: Schema.Void,
        output: Schema.Record(Schema.String, Schema.String),
        run: () =>
          Object.fromEntries(
            db.orm
              .select()
              .from(preferences)
              .where(sql`${preferences.scope} = ${providerScope}`)
              .all()
              .map((row) => [
                row.key,
                Schema.decodeUnknownSync(Schema.String)(JSON.parse(row.value))
              ])
          )
      })
    },
    mutations: {
      saveApiKey: storeMutation({
        changes: ['auth'],
        input: Schema.Struct({ provider: Schema.String, apiKey: Schema.NullOr(Schema.String) }),
        output: Schema.Void,
        run: ({ provider, apiKey }) => {
          if (apiKey === null) {
            db.orm
              .delete(preferences)
              .where(
                sql`${preferences.scope} = ${providerScope} AND ${preferences.key} = ${provider}`
              )
              .run();
          } else {
            db.orm
              .insert(preferences)
              .values({ scope: providerScope, key: provider, value: JSON.stringify(apiKey) })
              .onConflictDoUpdate({
                target: [preferences.scope, preferences.key],
                set: { value: JSON.stringify(apiKey) }
              })
              .run();
          }

          replaceGeneration();
        }
      })
    }
  };
}
