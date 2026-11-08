/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists Assistant chat identities, history pagination and compacted memory.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps Assistant note state typed and durably persisted.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private stores own SQLite; public feature services coordinate behavior.                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import {
  assistantToolIntentSchema,
  assistantToolReceiptSchema,
  assistantToolResultSchema
} from '@study/contracts/notes/assistant';
import { and, eq } from '@study/db';
import { assistant_tool_receipts } from '@study/db/schema';
import { Option, Schema } from 'effect';

import { defineStore, storeMutation } from '#server/platform/definitions/define-store';

const json = Schema.fromJsonString(Schema.Json);

const encode = Schema.encodeSync(json);

const decode = Schema.decodeUnknownSync(json);

export const AssistantToolStore = defineStore({
  name: 'study/AssistantToolStore',
  entity: { singular: 'assistantTool', plural: 'assistantTools' },
  make: ({ db }) => {
    const key = (
      input: typeof assistantToolIntentSchema.Type | typeof assistantToolResultSchema.Type
    ) =>
      and(
        eq(assistant_tool_receipts.version_id, input.versionId),
        eq(assistant_tool_receipts.name, input.name),
        eq(assistant_tool_receipts.ordinal, input.ordinal)
      );

    return {
      queries: {},
      mutations: {
        intent: storeMutation({
          input: assistantToolIntentSchema,
          output: assistantToolReceiptSchema,
          run: (input) => {
            db.orm
              .insert(assistant_tool_receipts)
              .values({
                version_id: input.versionId,
                name: input.name,
                ordinal: input.ordinal,
                input: encode(input.input)
              })
              .onConflictDoNothing()
              .run();
            const row = db.orm.select().from(assistant_tool_receipts).where(key(input)).get();

            if (!row) throw new StudyError('internal', 'Tool intent was not retained');

            return {
              input: decode(row.input),
              result: row.result === null ? Option.none() : Option.some(decode(row.result))
            };
          }
        }),
        complete: storeMutation({
          input: assistantToolResultSchema,
          output: Schema.Json,
          run: (input) => {
            const row = db.orm
              .update(assistant_tool_receipts)
              .set({ result: encode(input.result) })
              .where(key(input))
              .returning()
              .get();

            if (!row) throw new StudyError('internal', 'Tool intent is unavailable');

            return decode(row.result!);
          }
        })
      }
    };
  }
});
