/** @file Builds notes reply readiness queries and mutations with bound store resources. */

import {
  StudyError,
  noteGenerationRequestedSchema,
  pendingReplyAttachmentSchema,
  replySnapshotInputSchema,
  sourceIdSchema
} from '@study/contracts';
/** Owns reply readiness within this feature. */
import {
  and,
  asc,
  eq,
  note_reply_requests,
  source_processing,
  sql,
  workflowEvents,
  workflowReceipts
} from '@study/db';
import { defineStore, storeQuery, decodeEvent } from '@study/server';
import { Schema } from 'effect';

import { codec } from './reply-schemas.ts';
import { makeReplySnapshots } from './reply-snapshots.ts';

export const ReplyReadinessStore = defineStore({
  name: 'study/NoteReplyReadinessStore',
  entity: { singular: 'replyReadiness', plural: 'replyReadinesses' },
  make: ({ db, clock, timestampClock }) => {
    const { readReplySnapshot } = makeReplySnapshots({ db, clock, timestampClock });

    return {
      queries: {
        replyReadiness: storeQuery({
          role: 'required',
          input: replySnapshotInputSchema,
          output: Schema.Array(pendingReplyAttachmentSchema),
          run: (input) => {
            const snapshot = readReplySnapshot(input);

            return (snapshot.pendingAttachments ?? []).filter((part) => {
              const state = db.orm
                .select()
                .from(source_processing)
                .where(eq(source_processing.source_id, part.sourceId))
                .get();

              return !state?.document_id || state.published_request_id !== part.requestId;
            });
          }
        })
      },
      mutations: {}
    };
  }
});

export const ReplyWakeStore = defineStore({
  name: 'study/NoteReplyWakeStore',
  entity: { singular: 'replyWake', plural: 'replyWakes' },
  make: ({ db }) => {
    return {
      queries: {
        replyWakes: storeQuery({
          role: 'collection',
          input: Schema.Struct({
            sourceId: sourceIdSchema,
            after: Schema.optional(Schema.String),
            limit: Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(100))
          }),
          output: Schema.Array(
            Schema.Struct({
              requestId: Schema.String,
              executionId: Schema.String,
              event: noteGenerationRequestedSchema,
              pendingAttachments: Schema.Array(pendingReplyAttachmentSchema)
            })
          ),
          run: (input) => {
            const rows = db.orm
              .select({
                request: note_reply_requests,
                event: workflowEvents,
                receipt: workflowReceipts
              })
              .from(note_reply_requests)
              .innerJoin(
                workflowEvents,
                and(
                  eq(workflowEvents.type, 'NoteGenerationRequested'),
                  eq(workflowEvents.correlationId, note_reply_requests.request_id)
                )
              )
              .innerJoin(
                workflowReceipts,
                and(
                  eq(workflowReceipts.eventId, workflowEvents.eventId),
                  eq(workflowReceipts.subscription, 'conversation-reply'),
                  eq(workflowReceipts.workflowVersion, 1),
                  eq(workflowReceipts.inputVersion, workflowEvents.inputVersion)
                )
              )
              .where(
                and(
                  input.after ? sql`${note_reply_requests.request_id} > ${input.after}` : sql`1`,
                  sql`json_array_length(${note_reply_requests.snapshot}, '$.pendingAttachments') > 0`,
                  sql`(EXISTS (SELECT 1 FROM json_each(${note_reply_requests.snapshot}, '$.pendingAttachments') AS pending WHERE json_extract(pending.value, '$.sourceId') = ${String(input.sourceId)}) OR EXISTS (SELECT 1 FROM json_each(${note_reply_requests.snapshot}, '$.messages') AS captured JOIN json_each(captured.value, '$.attachments') AS attachment WHERE json_extract(attachment.value, '$.sourceId') = ${String(input.sourceId)}))`
                )
              )
              .orderBy(asc(note_reply_requests.request_id))
              .limit(input.limit)
              .all();

            return rows.map(({ request, event, receipt }) => {
              const decoded = decodeEvent(event.payload);

              if (
                decoded.type !== 'NoteGenerationRequested' ||
                decoded.requestId !== request.request_id ||
                decoded.noteId !== request.note_id ||
                decoded.versionId !== request.version_id
              )
                throw new StudyError('invalid_input', 'reply event identity mismatch');

              return {
                requestId: request.request_id,
                executionId: receipt.executionId,
                event: decoded,
                pendingAttachments:
                  Schema.decodeUnknownSync(codec)(request.snapshot).pendingAttachments ?? []
              };
            });
          }
        })
      },
      mutations: {}
    };
  }
});
