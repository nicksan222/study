import { createHash } from 'node:crypto';

import { StudyError } from '@study/contracts/errors';
import { projectIdSchema, sessionIdSchema, sourceIdSchema } from '@study/contracts/ids';
import { and, eq } from '@study/db';
import * as tables from '@study/db/schema';
import { Option, Schema } from 'effect';

import { validateRecordingImport } from '#server/features/sources/decoders/recording';
import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';

const inputSchema = Schema.Struct({
  requestId: Schema.String,
  projectId: projectIdSchema,
  sessionId: sessionIdSchema,
  name: Schema.String,
  bytes: Schema.Uint8Array,
  durationMs: Schema.Number
});

const receiptSchema = Schema.Struct({ sourceId: sourceIdSchema, hash: Schema.Uint8Array });

function hash(input: typeof inputSchema.Type) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.requestId,
        String(input.projectId),
        String(input.sessionId),
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
          const session = db.orm
            .select({ id: tables.sessions.id })
            .from(tables.sessions)
            .where(
              and(
                eq(tables.sessions.id, input.sessionId),
                eq(tables.sessions.project_id, input.projectId)
              )
            )
            .get();

          if (!session)
            throw new StudyError('invalid_input', 'recording session does not belong to project');

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
              session_id: input.sessionId,
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
