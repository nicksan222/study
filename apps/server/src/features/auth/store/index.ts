/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists the private ChatGPT account and credential-generation fence in            │
 * │ preferences.                                                                             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Updates the credential generation whenever saved account credentials change.           │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the auth service applies policy and composes    │
 * │ these private operations.                                                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { sql } from '@study/db';
import { preferences } from '@study/db/schema';
import { Option, Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

const scope = 'private.chatgpt';

const key = 'account';

const providerScope = 'private.ai-providers';

function makeHelpers({ db }: StoreResources) {
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
        ensureHostId: storeMutation({
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

export const AuthBackupStore = defineStore({
  name: 'study/AuthBackupStore',
  entity: { singular: 'backupSanitized', plural: 'backupSanitizedAccounts' },
  make: ({ db }) => ({
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
  })
});

/** Private provider credentials share the account's durable generation fence. */
export const ApiKeyStore = defineStore({
  name: 'study/ApiKeyStore',
  entity: { singular: 'apiKeys', plural: 'apiKeySets' },
  make: ({ db, clock }) => {
    const { replaceGeneration } = makeHelpers({ db, clock });

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
});
