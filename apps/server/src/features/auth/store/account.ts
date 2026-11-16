/** @file Owns account within this feature. */

import { preferences, sql } from '@study/db';
import { storeMutation, storeQuery } from '@study/server';
import type { StoreResources } from '@study/server';
import { Option, Schema } from 'effect';

import { providerScope } from './scopes.ts';

export const scope = 'private.chatgpt';

const key = 'account';

export function makeHelpers({ db }: StoreResources) {
  function replaceGeneration() {
    const value = JSON.stringify(crypto.randomUUID());

    db.orm
      .insert(preferences)
      .values({ scope, key: 'credential-generation', value })
      .onConflictDoUpdate({ target: [preferences.scope, preferences.key], set: { value } })
      .run();
  }

  return { replaceGeneration };
}

export function makeAuthStore({ db, clock, timestampClock }: StoreResources) {
  const { replaceGeneration } = makeHelpers({ db, clock, timestampClock });

  return {
    queries: {
      findAccount: storeQuery({
        role: 'optional',
        input: Schema.Void,
        output: Schema.Option(Schema.Json),
        run: () => {
          const row = db.orm
            .select()
            .from(preferences)
            .where(sql`${preferences.scope} = ${scope} AND ${preferences.key} = ${key}`)
            .get();

          return row
            ? Option.some(Schema.decodeUnknownSync(Schema.Json)(JSON.parse(row.value)))
            : Option.none();
        }
      })
    },
    mutations: {
      ensureHostId: storeMutation({
        changes: ['auth'],
        input: Schema.Void,
        output: Schema.String,
        run: () => {
          const row = db.orm
            .select()
            .from(preferences)
            .where(sql`${preferences.scope} = ${scope} AND ${preferences.key} = ${'host-id'}`)
            .get();

          if (row) return Schema.decodeUnknownSync(Schema.String)(JSON.parse(row.value));

          const hostId = `urn:uuid:${crypto.randomUUID()}`;

          db.orm
            .insert(preferences)
            .values({ scope, key: 'host-id', value: JSON.stringify(hostId) })
            .run();

          return hostId;
        }
      }),
      sanitizeBackup: storeMutation({
        changes: ['auth'],
        input: Schema.Void,
        output: Schema.Void,
        run: () => {
          db.orm
            .delete(preferences)
            .where(sql`${preferences.scope} IN (${scope}, ${providerScope})`)
            .run();
        }
      }),
      saveAccount: storeMutation({
        changes: ['auth'],
        input: Schema.Json,
        output: Schema.Void,
        run: (value) => {
          db.orm
            .insert(preferences)
            .values({ scope, key, value: JSON.stringify(value) })
            .onConflictDoUpdate({
              target: [preferences.scope, preferences.key],
              set: { value: JSON.stringify(value) }
            })
            .run();
          replaceGeneration();
        }
      }),
      deleteAccount: storeMutation({
        changes: ['auth'],
        input: Schema.Void,
        output: Schema.Void,
        run: () => {
          db.orm
            .delete(preferences)
            .where(sql`${preferences.scope} = ${scope} AND ${preferences.key} = ${key}`)
            .run();
          replaceGeneration();
        }
      })
    }
  };
}

export function makeAuthGenerationStore({ db }: StoreResources) {
  return {
    queries: {
      credentialGeneration: storeQuery({
        role: 'required',
        input: Schema.Void,
        output: Schema.String,
        run: () => {
          const row = db.orm
            .select()
            .from(preferences)
            .where(
              sql`${preferences.scope} = ${scope} AND ${preferences.key} = ${'credential-generation'}`
            )
            .get();

          return row ? Schema.decodeUnknownSync(Schema.String)(JSON.parse(row.value)) : 'initial';
        }
      })
    },
    mutations: {}
  };
}
