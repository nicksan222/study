/** @file Stores the last successful catalog and per-tier dismissed recommendations. */
import { modelCatalogSchema, modelSuggestionsSchema, modelUpdateSchema } from '@study/contracts';
import { preferences, sql } from '@study/db';
import { catalogIdentitiesSchema, defineStore, storeMutation, storeQuery } from '@study/server';
import { Schema } from 'effect';

import { writePreference } from './write-preference';

const snapshot = Schema.Struct({
  catalog: modelCatalogSchema,
  chatAccount: Schema.optionalKey(Schema.NullOr(Schema.String)),
  identities: Schema.optionalKey(catalogIdentitiesSchema),
  suggestions: Schema.optionalKey(modelSuggestionsSchema),
  recommendations: Schema.Array(modelUpdateSchema),
  dismissed: Schema.Array(modelUpdateSchema)
});

type Snapshot = typeof snapshot.Type;

export function accountCatalog(state: Snapshot, account: string | null | undefined): Snapshot {
  if (state.chatAccount === account) return state;

  const { '1': _chat, ...catalog } = state.catalog;

  return {
    ...state,
    catalog,
    recommendations: state.recommendations.filter((notice) => notice.provider !== 1),
    dismissed: state.dismissed.filter((notice) => notice.provider !== 1)
  };
}

const encode = Schema.encodeSync(Schema.fromJsonString(snapshot));

const decode = Schema.decodeUnknownSync(Schema.fromJsonString(snapshot));

const scope = 'model-catalog';

const key = 'snapshot';

export const ModelUpdatesStore = defineStore({
  name: 'study/ModelUpdatesStore',
  entity: { singular: 'modelUpdate', plural: 'modelUpdates' },
  make: ({ db }) => ({
    queries: {
      snapshot: storeQuery({
        role: 'required',
        input: Schema.Void,
        output: snapshot,
        run: () => {
          const row = db.orm
            .select({ value: preferences.value })
            .from(preferences)
            .where(sql`${preferences.scope} = ${scope} AND ${preferences.key} = ${key}`)
            .get();

          return row ? decode(row.value) : { catalog: {}, recommendations: [], dismissed: [] };
        }
      })
    },
    mutations: {
      save: storeMutation({
        changes: ['settings'],
        input: snapshot,
        output: Schema.Void,
        run: (state) => writePreference(db, scope, key, encode(state))
      })
    }
  })
});
