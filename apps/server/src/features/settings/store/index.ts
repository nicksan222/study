import {
  appSettingsSchema,
  llmSettingsSchema,
  materialSettingsSchema,
  reviewSettingsSchema
} from '@study/contracts/settings/schemas';
import { sql } from '@study/db';
import { preferences } from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

const values = Schema.Record(Schema.String, Schema.MutableJson);

function makeHelpers({ db }: StoreResources) {
  function replace(scope: string, entries: Record<string, typeof Schema.MutableJson.Type>) {
    db.orm
      .delete(preferences)
      .where(sql`scope = ${scope}`)
      .run();

    for (const [key, value] of Object.entries(entries))
      db.orm.run(
        sql`INSERT INTO preferences (scope, key, value) VALUES (${scope}, ${key}, ${JSON.stringify(value)})`
      );
  }

  return { replace };
}

export const SettingsStore = defineStore({
  name: 'study/SettingsStore',
  entity: { singular: 'preference', plural: 'preferences' },
  make: ({ db, clock }) => {
    const { replace } = makeHelpers({ db, clock });

    return {
      queries: {
        preference: storeQuery({
          role: 'required',
          input: Schema.String,
          output: values,
          run: (scope) => {
            const result: Record<string, typeof Schema.MutableJson.Type> = {};

            for (const row of db.orm
              .select()
              .from(preferences)
              .where(sql`scope = ${scope}`)
              .all())
              Object.defineProperty(result, row.key, {
                value: Schema.decodeUnknownSync(Schema.MutableJson)(JSON.parse(row.value)),
                enumerable: true,
                configurable: true,
                writable: true
              });

            return result;
          }
        })
      },
      mutations: {
        saveAppSettings: storeMutation({
          input: appSettingsSchema,
          output: Schema.Void,
          run: (input) => replace('app', { ...input })
        }),
        saveLlmSettings: storeMutation({
          input: llmSettingsSchema,
          output: Schema.Void,
          run: (input) =>
            replace('llm', {
              tiny: input.tiny.model ?? null,
              medium: input.medium.model ?? null,
              smart: input.smart.model ?? null
            })
        }),
        saveMaterialSettings: storeMutation({
          input: materialSettingsSchema,
          output: Schema.Void,
          run: (input) => replace('material', { ...input })
        }),
        saveReviewSettings: storeMutation({
          input: reviewSettingsSchema,
          output: Schema.Void,
          run: (input) => replace('review', { ...input })
        })
      }
    };
  }
});
