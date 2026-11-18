/** @file Stores one release baseline and pending notice per provider and model family. */
import { modelUpdateSchema } from '@study/contracts';
import { preferences, sql } from '@study/db';
import { defineStore, modelReleaseSchema, storeMutation, storeQuery } from '@study/server';
import { Option, Schema } from 'effect';

const scope = 'model-updates';

const keySchema = Schema.Struct({ provider: Schema.String, family: Schema.String });

const stateSchema = Schema.Struct({
  release: modelReleaseSchema,
  pending: Schema.optionalKey(modelUpdateSchema)
});

const decode = Schema.decodeUnknownSync(Schema.fromJsonString(stateSchema));

const encode = Schema.encodeSync(Schema.fromJsonString(stateSchema));

const key = ({ provider, family }: typeof keySchema.Type) => JSON.stringify([provider, family]);

export const ModelUpdatesStore = defineStore({
  name: 'study/ModelUpdatesStore',
  entity: { singular: 'modelUpdate', plural: 'modelUpdates' },
  make: ({ db }) => ({
    queries: {
      state: storeQuery({
        role: 'optional',
        input: keySchema,
        output: Schema.Option(stateSchema),
        run: (identity) => {
          const row = db.orm
            .select({ value: preferences.value })
            .from(preferences)
            .where(sql`${preferences.scope} = ${scope} AND ${preferences.key} = ${key(identity)}`)
            .get();

          return row ? Option.some(decode(row.value)) : Option.none();
        }
      }),
      pending: storeQuery({
        role: 'required',
        input: Schema.Void,
        output: Schema.Array(modelUpdateSchema),
        run: () =>
          db.orm
            .select({ value: preferences.value })
            .from(preferences)
            .where(
              sql`${preferences.scope} = ${scope} AND json_type(${preferences.value}, '$.pending') = 'object'`
            )
            .orderBy(preferences.key)
            .limit(1)
            .all()
            .flatMap(({ value }) => {
              const pending = decode(value).pending;

              return pending ? [pending] : [];
            })
      })
    },
    mutations: {
      save: storeMutation({
        changes: ['settings'],
        input: stateSchema,
        output: Schema.Void,
        run: (state) => {
          const value = encode(state);

          db.orm
            .insert(preferences)
            .values({ scope, key: key(state.release), value })
            .onConflictDoUpdate({ target: [preferences.scope, preferences.key], set: { value } })
            .run();
        }
      })
    }
  })
});
