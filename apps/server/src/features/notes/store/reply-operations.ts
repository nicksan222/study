/** @file Owns reply operations within this feature. */

import {
  StudyError,
  convertMessageInputSchema,
  reanswerInputSchema,
  replyRequestInputSchema,
  replyRequestSchema,
  replySnapshotInputSchema,
  replySnapshotSchema,
  rewriteMessageInputSchema,
  runSelectionContextSchema
} from '@study/contracts';
import { and, eq, message_versions, messages, note_reply_requests, sql } from '@study/db';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';

import { makeReplyCapture } from './reply-capture.ts';
import { generationMatches, replyTargetPredicate } from './reply-identity.ts';
import { makeReplyPending } from './reply-pending.ts';
import { makeReplyPublicationMutations } from './reply-publication.ts';
import { codec, requestInput } from './reply-schemas.ts';
import { makeReplySealingMutations } from './reply-sealing.ts';
import { makeReplySnapshots } from './reply-snapshots.ts';

export const ReplyStore = defineStore({
  name: 'study/NoteReplyStore',
  entity: { singular: 'replySnapshot', plural: 'replySnapshots' },
  make: ({ db, clock, timestampClock }) => {
    const { snapshot } = makeReplyCapture({ db, clock, timestampClock });
    const { readReplySnapshot } = makeReplySnapshots({ db, clock, timestampClock });
    const { discardPending, retirePending, prepareReply } = makeReplyPending({
      db,
      clock,
      timestampClock
    });

    /** Rejects overlapping generation while allowing completed and failed history. */
    function requireNoActiveVersion(messageId: typeof message_versions.$inferSelect.message_id) {
      const active = db.orm
        .select({ id: message_versions.id })
        .from(message_versions)
        .where(
          and(
            eq(message_versions.message_id, messageId),
            sql`${message_versions.status} IN ('pending', 'writing')`
          )
        )
        .get();

      if (active) throw new StudyError('invalid_input', 'Message already has pending work');
    }

    return {
      queries: {
        replySnapshot: storeQuery({
          role: 'required',
          input: replySnapshotInputSchema,
          output: replySnapshotSchema,
          run: readReplySnapshot
        })
      },
      mutations: {
        ...makeReplySealingMutations({ db, clock, timestampClock }),
        failConversion: storeMutation({
          changes: ['notes'],
          input: replyRequestSchema,
          output: Schema.Boolean,
          run: (input) => {
            const found = db.orm
              .select({ origin: message_versions.origin, status: message_versions.status })
              .from(message_versions)
              .innerJoin(messages, eq(messages.id, message_versions.message_id))
              .where(
                and(
                  replyTargetPredicate(input),
                  eq(message_versions.generation_request_id, input.requestId)
                )
              )
              .get();

            if (!found || found.origin !== 'convert' || found.status === 'complete') return false;

            db.orm
              .update(message_versions)
              .set({ status: 'failed' })
              .where(eq(message_versions.id, input.versionId))
              .run();

            return true;
          }
        }),
        abandonReply: storeMutation({
          changes: ['notes'],
          input: replyRequestSchema,
          output: Schema.Boolean,
          run: (input) => {
            const request = db.orm
              .select()
              .from(note_reply_requests)
              .where(eq(note_reply_requests.request_id, input.requestId))
              .get();

            if (
              !request ||
              request.note_id !== input.noteId ||
              request.version_id !== input.versionId
            )
              return false;

            const version = db.orm
              .select()
              .from(message_versions)
              .where(eq(message_versions.id, request.version_id))
              .get();

            if (!version || version.status === 'complete') return false;

            const message = db.orm
              .select()
              .from(messages)
              .where(eq(messages.id, version.message_id))
              .get();

            assertAbandonTarget();

            function assertAbandonTarget() {
              if (
                !message ||
                message.note_id !== request!.note_id ||
                message.id !== input.messageId ||
                !generationMatches(
                  version!,
                  Schema.decodeUnknownSync(codec)(request!.snapshot),
                  message.role
                )
              )
                throw new StudyError('invalid_input', 'invalid reply target');
            }

            discardPending(message!, version);

            return true;
          }
        }),
        ...makeReplyPublicationMutations({ db, clock, timestampClock }),
        prepareReply: storeMutation({
          changes: ['notes'],
          input: replyRequestInputSchema,
          output: Schema.Void,
          run: prepareReply
        }),
        retireTargetPending: storeMutation({
          changes: ['notes'],
          input: reanswerInputSchema,
          output: Schema.Void,
          run: ({ messageId }) => {
            const message = db.orm.select().from(messages).where(eq(messages.id, messageId)).get();

            if (!message) throw new StudyError('not_found', 'message not found');

            retirePending(message, true);
          }
        }),
        requestConversion: storeMutation({
          changes: ['notes'],
          input: convertMessageInputSchema,
          output: Schema.Struct({ ...replyRequestSchema.fields, created: Schema.Boolean }),
          run: (input) => {
            /** Fence both new requests and failed retries against the active base version. */
            function requireCurrentTarget() {
              const message = db.orm
                .select()
                .from(messages)
                .where(eq(messages.id, input.messageId))
                .get();

              if (
                !message ||
                message.role !== 'user' ||
                message.active_version_id !== input.expectedActiveVersionId
              )
                throw new StudyError('invalid_input', 'Conversion target changed');

              return message;
            }

            const existing = db.orm
              .select()
              .from(note_reply_requests)
              .innerJoin(message_versions, eq(message_versions.id, note_reply_requests.version_id))
              .where(
                and(
                  eq(message_versions.message_id, input.messageId),
                  eq(message_versions.based_on, input.expectedActiveVersionId),
                  eq(message_versions.origin, 'convert')
                )
              )
              .all();

            for (const row of existing) {
              const saved = Schema.decodeUnknownSync(codec)(row.note_reply_requests.snapshot);

              if (saved.generation?.conversion?.strategyId === input.strategyId) {
                const retry = row.message_versions.status === 'failed';

                if (retry) {
                  requireCurrentTarget();
                  requireNoActiveVersion(input.messageId);
                  db.orm
                    .update(message_versions)
                    .set({ status: 'pending' })
                    .where(eq(message_versions.id, saved.versionId))
                    .run();
                }

                return {
                  requestId: saved.requestId,
                  noteId: saved.noteId,
                  messageId: saved.messageId,
                  versionId: saved.versionId,
                  created: retry
                };
              }
            }

            const message = requireCurrentTarget();

            requireNoActiveVersion(input.messageId);

            const result = snapshot(
              { noteId: message.note_id, requestId: crypto.randomUUID() },
              {
                messageId: message.id,
                origin: 'convert',
                instruction: null,
                conversion: {
                  strategyId: input.strategyId,
                  baseVersionId: input.expectedActiveVersionId
                }
              }
            );

            return { ...result, created: true };
          }
        }),
        requestTarget: storeMutation({
          changes: ['notes'],
          input: Schema.Struct({
            ...rewriteMessageInputSchema.fields,
            origin: Schema.Literals(['answer', 'improve', 'summarize', 'instruction']),
            requestId: Schema.String,
            context: Schema.optional(runSelectionContextSchema)
          }),
          output: replyRequestSchema,
          run: (input) => {
            const message = db.orm
              .select()
              .from(messages)
              .where(eq(messages.id, input.messageId))
              .get();

            if (!message) throw new StudyError('not_found', 'message not found');

            const instruction = input.instruction?.trim() || null;

            if (input.origin === 'instruction' && instruction === null)
              throw new StudyError('invalid_input', 'invalid instruction');

            retirePending(message, true);

            return snapshot(
              { noteId: message.note_id, requestId: input.requestId, context: input.context },
              {
                messageId: message.id,
                origin: input.origin,
                instruction
              }
            );
          }
        }),
        requestQuestionReply: storeMutation({
          changes: ['notes'],
          input: requestInput,
          output: replyRequestSchema,
          run: (input) => {
            if (!input.context || input.context.messages.at(-1)?.role !== 'user')
              throw new StudyError('invalid_input', 'Question requires a captured user target');

            const question = input.context.messages.at(-1)!;

            return snapshot(input, {
              messageId: question.messageId,
              origin: 'answer',
              instruction: null,
              questionVersionId: question.versionId
            });
          }
        }),
        requestReply: storeMutation({
          changes: ['notes'],
          input: requestInput,
          output: replyRequestSchema,
          run: (input) => {
            prepareReply(input);

            return snapshot(input);
          }
        })
      }
    };
  }
});
