/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reads active workflow identities associated with note-owned requests.              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Discover note transforms, replies, attachment processing and title work.               │
 * │ - Apply stable pagination before canonical execution decoding.                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Note ownership stays here; workflow services own execution state and controls.           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { noteWorkInputSchema, noteWorkKindSchema } from '@study/contracts/notes/work';
import { executionIdSchema } from '@study/contracts/workflows/schemas';
import { and, desc, inArray, or, sql } from '@study/db';
import { workflow_executions } from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';

const ownedWorkSchema = Schema.Struct({
  executionId: executionIdSchema,
  createdAtMs: Schema.BigInt,
  kind: noteWorkKindSchema,
  title: Schema.NullOr(Schema.String),
  requestId: Schema.String
});

export const NoteWorkStore = defineStore({
  name: 'study/NoteWorkStore',
  entity: { singular: 'noteWorkItem', plural: 'noteWorkItems' },
  make: ({ db }) => ({
    queries: {
      noteWorkItems: storeQuery({
        role: 'collection',
        input: noteWorkInputSchema,
        output: Schema.Array(ownedWorkSchema),
        run: (input) => {
          const correlation = sql<string>`json_extract(${workflow_executions.payload}, '$.event.correlationId')`;
          const transform = sql`EXISTS (
            SELECT 1 FROM page_transform_requests r
            WHERE r.note_id = ${input.noteId} AND r.id = ${correlation}
          )`;
          const reply = sql`EXISTS (
            SELECT 1 FROM note_reply_requests r
            WHERE r.note_id = ${input.noteId} AND r.request_id = ${correlation}
          )`;
          const attachment = sql`EXISTS (
            SELECT 1 FROM messages m
            JOIN message_parts p ON p.message_id = m.id
            JOIN source_processing sp ON sp.source_id = p.source_id
            WHERE m.note_id = ${input.noteId} AND sp.request_id = ${correlation}
          )`;
          const title = sql`json_extract(${workflow_executions.payload}, '$.event.type') = 'NoteTitleRequested'
            AND json_extract(${workflow_executions.payload}, '$.event.noteId') = ${String(input.noteId)}`;

          return db.orm
            .select({
              executionId: workflow_executions.execution_id,
              createdAtMs: workflow_executions.created_at,
              requestId: correlation,
              kind: sql<typeof noteWorkKindSchema.Type>`CASE WHEN ${transform} THEN 'transform'
              WHEN ${reply} THEN 'reply' WHEN ${attachment} THEN 'attachment' ELSE 'title' END`,
              title: sql<string | null>`CASE WHEN ${transform} THEN (
              SELECT json_extract(r.request, '$.title') FROM page_transform_requests r
              WHERE r.note_id = ${input.noteId} AND r.id = ${correlation}
            ) WHEN ${attachment} THEN (
              SELECT p.source_name FROM messages m
              JOIN message_parts p ON p.message_id = m.id
              JOIN source_processing sp ON sp.source_id = p.source_id
              WHERE m.note_id = ${input.noteId} AND sp.request_id = ${correlation}
              ORDER BY p.id LIMIT 1
            ) ELSE NULL END`
            })
            .from(workflow_executions)
            .where(
              and(
                inArray(workflow_executions.status, ['running', 'suspended']),
                or(transform, reply, attachment, sql`(${title})`),
                input.before === undefined
                  ? undefined
                  : sql`(${workflow_executions.created_at}, ${workflow_executions.execution_id}) <
                      (${input.before.createdAtMs}, ${input.before.id})`
              )
            )
            .orderBy(desc(workflow_executions.created_at), desc(workflow_executions.execution_id))
            .limit(input.limit)
            .all()
            .map((row) => ({
              ...row,
              executionId: Schema.decodeUnknownSync(executionIdSchema)(row.executionId)
            }));
        }
      })
    },
    mutations: {}
  })
});
