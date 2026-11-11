/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Stores imported recording sources with request identity and validates their WAV    │
 * │ payload before persistence.                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Feature stores own SQLite access and map rows to typed contracts.                      │
 * │ - Queries or mutates feature-owned database records.                                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Keeps SQL and schema mapping behind typed store operations.                              │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { projectIdSchema, noteIdSchema, sourceIdSchema } from '@study/contracts/ids';
import { and, eq } from '@study/db';
import * as tables from '@study/db/schema';
import { CryptoHasher } from 'bun';
import { Option, Schema } from 'effect';

import { validateRecordingImport } from '#server/features/sources/decoders/recording';
import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';

const inputSchema = Schema.Struct({
  requestId: Schema.String,
  projectId: Schema.NullOr(projectIdSchema),
  noteId: noteIdSchema,
  name: Schema.String,
  bytes: Schema.Uint8Array,
  durationMs: Schema.Number
});

const receiptSchema = Schema.Struct({ sourceId: sourceIdSchema, hash: Schema.Uint8Array });

function hash(input: typeof inputSchema.Type) {
  return new CryptoHasher('sha256')
    .update(
      JSON.stringify([
        input.requestId,
        String(input.projectId),
        String(input.noteId),
        input.name,
        input.durationMs
      ])
    )
    .update(input.bytes)
    .digest();
}

export const RecordingImportStore = defineStore({
  name: 'study/RecordingImportStore',
  entity: { singular: 'recordingImport', plural: 'recordingImports' },
  make: ({ db }) => ({
    queries: {
      findRecordingImport: storeQuery({
        role: 'optional',
        input: Schema.String,
        output: Schema.Option(receiptSchema),
        run: (requestId) => {
          const row = db.orm
            .select()
            .from(tables.source_recording_imports)
            .where(eq(tables.source_recording_imports.request_id, requestId))
            .get();

          return Option.fromNullishOr(
            row ? { sourceId: row.source_id, hash: new Uint8Array(row.input_hash) } : null
          );
        }
      })
    },
    mutations: {
      validateRecordingImport: storeMutation({
        input: inputSchema,
        output: Schema.Uint8Array,
        run: (input) => {
          validateRecordingImport(input);
          const note = db.orm
            .select({ id: tables.notes.id })
            .from(tables.notes)
            .where(and(eq(tables.notes.id, input.noteId)))
            .get();

          if (!note)
            throw new StudyError('invalid_input', 'recording note does not belong to project');

          return hash(input);
        }
      }),
      saveRecordingImport: storeMutation({
        input: Schema.Struct({
          ...inputSchema.fields,
          sourceId: sourceIdSchema,
          hash: Schema.Uint8Array
        }),
        output: Schema.Void,
        run: (input) => {
          db.orm
            .insert(tables.source_recording_imports)
            .values({
              request_id: input.requestId,
              project_id: input.projectId,
              note_id: input.noteId,
              source_id: input.sourceId,
              input_hash: Buffer.from(input.hash),
              duration_ms: BigInt(input.durationMs)
            })
            .run();
        }
      })
    }
  })
});
