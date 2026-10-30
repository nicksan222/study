import { randomUUID } from 'node:crypto';

import { sql } from '@study/db';
import { preferences } from '@study/db/schema';
import { Option, Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

const scope = 'private.chatgpt';

const key = 'account';

function makeHelpers({ db }: StoreResources) {
  function replaceGeneration() {
    const value = JSON.stringify(randomUUID());

    db.orm
      .insert(preferences)
      .values({ scope, key: 'credential-generation', value })
      .onConflictDoUpdate({ target: [preferences.scope, preferences.key], set: { value } })
      .run();
  }

  return { replaceGeneration };
}

export const AuthStore = defineStore({
  name: 'study/AuthStore',
  entity: { singular: 'account', plural: 'accounts' },
  make: ({ db, clock }) => {
    const { replaceGeneration } = makeHelpers({ db, clock });

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
        saveAccount: storeMutation({
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
});

export const AuthGenerationStore = defineStore({
  name: 'study/AuthGenerationStore',
  entity: { singular: 'credentialGeneration', plural: 'credentialGenerations' },
  make: ({ db }) => ({
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
  })
});
