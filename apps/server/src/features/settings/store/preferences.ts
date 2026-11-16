/** @file Owns preferences within this feature. */

import {
  agentRulesSchema,
  appSettingsSchema,
  appearancePreferencesSchema,
  concurrencySettingsSchema,
  llmSettingsSchema,
  materialSettingsSchema,
  quizSettingsSchema,
  reviewSettingsSchema,
  sidebarSettingsSchema,
  workspacePreferencesSchema
} from '@study/contracts';
import { preferences, sql } from '@study/db';
import { storeMutation, storeQuery } from '@study/server';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

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

export function makeSettingsStore({ db, clock, timestampClock }: StoreResources) {
  const { replace } = makeHelpers({ db, clock, timestampClock });

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
      saveAgentRules: storeMutation({
        changes: ['settings'],
        input: agentRulesSchema,
        output: Schema.Void,
        run: (input) => replace('agent-rules', { ...input })
      }),
      saveQuizSettings: storeMutation({
        changes: ['settings'],
        input: quizSettingsSchema,
        output: Schema.Void,
        run: (input) => replace('quiz', { ...input })
      }),
      saveWorkspacePreferences: storeMutation({
        changes: ['settings'],
        input: workspacePreferencesSchema,
        output: Schema.Void,
        run: (input) => replace('workspace', { ...input })
      }),
      saveSidebarSettings: storeMutation({
        changes: ['settings'],
        input: sidebarSettingsSchema,
        output: Schema.Void,
        run: (input) => replace('sidebar', { ...input })
      }),
      saveConcurrencySettings: storeMutation({
        changes: ['settings'],
        input: concurrencySettingsSchema,
        output: Schema.Void,
        run: (input) => replace('concurrency', { ...input })
      }),
      saveAppearancePreferences: storeMutation({
        changes: ['settings'],
        input: appearancePreferencesSchema,
        output: Schema.Void,
        run: (input) => replace('appearance', { ...input })
      }),
      saveAppSettings: storeMutation({
        changes: ['settings'],
        input: appSettingsSchema,
        output: Schema.Void,
        run: (input) => replace('app', { ...input })
      }),
      saveLlmSettings: storeMutation({
        changes: ['settings'],
        input: llmSettingsSchema,
        output: Schema.Void,
        run: (input) =>
          replace('llm', {
            tiny: { ...input.tiny },
            medium: { ...input.medium },
            smart: { ...input.smart }
          })
      }),
      saveMaterialSettings: storeMutation({
        changes: ['settings'],
        input: materialSettingsSchema,
        output: Schema.Void,
        run: (input) => replace('material', { ...input })
      }),
      saveReviewSettings: storeMutation({
        changes: ['settings'],
        input: reviewSettingsSchema,
        output: Schema.Void,
        run: (input) => replace('review', { ...input })
      })
    }
  };
}
