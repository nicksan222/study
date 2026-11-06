/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists version bound classifications and unique question answer receipts.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Fences classifications against edits and explicit manual corrections.                  │
 * │ - Retains answer identities for deduplication and terminal recovery.                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private stores own SQLite access while conversation services coordinate domain behavior. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import {
  questionVersionInputSchema,
  setMessageKindInputSchema,
  questionClassificationSchema,
  replyRequestSchema
} from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { and, eq } from '@study/db';
import {
  messages,
  message_versions,
  conversation_question_answers,
  session_deletions,
  workflowEvents
} from '@study/db/schema';
import { Option, Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { activeMessageCondition } from './archive.ts';
import { makeDiscardPending } from './pending.ts';

export const QuestionStore = defineStore({
  name: 'study/ConversationQuestionStore',
  entity: { singular: 'questionSnapshot', plural: 'questionSnapshots' },
  make: ({ db, clock }) => {
    const current = makeCurrent({ db });
    const discardPending = makeDiscardPending({ db, clock });

    return {
      queries: {
        questionSnapshot: storeQuery({
          role: 'required',
          input: questionVersionInputSchema,
          output: Schema.Struct({
            text: Schema.String,
            manual: Schema.Boolean,
            kind: Schema.NullOr(questionClassificationSchema.fields.kind),
            scheduled: Schema.Boolean
          }),
          run: (input) => {
            const { row, version } = current(input);

            return {
              text: version.text,
              manual: row.question_origin === 'manual',
              kind: row.question_kind,
              scheduled: !!db.orm
                .select()
                .from(workflowEvents)
                .where(
                  eq(
                    workflowEvents.eventId,
                    `question/${input.messageId}/${input.expectedActiveVersionId}`
                  )
                )
                .get()
            };
          }
        })
      },
      mutations: {
        retireQuestionAnswer: storeMutation({
          input: questionVersionInputSchema,
          output: Schema.Void,
          run: (input) => {
            const { row } = current(input);
            const receipt = db.orm
              .select()
              .from(conversation_question_answers)
              .where(eq(conversation_question_answers.version_id, input.expectedActiveVersionId))
              .get();

            if (receipt) {
              const answer = db.orm
                .select()
                .from(message_versions)
                .where(eq(message_versions.id, receipt.answer_version_id))
                .get();

              if (answer && answer.message_id === row.id) discardPending(row, answer);
              else db.orm.delete(messages).where(eq(messages.id, receipt.answer_message_id)).run();
            }
          }
        }),

        setQuestionKind: storeMutation({
          input: setMessageKindInputSchema,
          output: Schema.Void,
          run: (input) => {
            current(input);
            db.orm
              .update(messages)
              .set({
                question_kind: input.kind,
                question_origin: 'manual',
                question_version_id: input.expectedActiveVersionId
              })
              .where(eq(messages.id, input.messageId))
              .run();
          }
        }),
        publishQuestion: storeMutation({
          input: Schema.Struct({
            ...questionVersionInputSchema.fields,
            ...questionClassificationSchema.fields
          }),
          output: Schema.Boolean,
          run: (input) => {
            const { row } = current(input);

            if (row.question_origin === 'manual') return false;

            db.orm
              .update(messages)
              .set({
                question_kind: input.kind,
                question_origin: 'automatic',
                question_version_id: input.expectedActiveVersionId
              })
              .where(eq(messages.id, input.messageId))
              .run();

            return true;
          }
        }),
        retainQuestionAnswer: storeMutation({
          input: Schema.Struct({
            ...questionVersionInputSchema.fields,
            answer: replyRequestSchema,
            guard: Schema.optional(Schema.Boolean)
          }),
          output: Schema.Void,
          run: (input) => {
            current(input);
            const insert = db.orm.insert(conversation_question_answers).values({
              version_id: input.expectedActiveVersionId,
              request_id: input.answer.requestId,
              answer_message_id: input.answer.messageId,
              answer_version_id: input.answer.versionId,
              question_guard: input.guard ?? true
            });

            if (input.guard === false)
              insert
                .onConflictDoNothing({ target: conversation_question_answers.version_id })
                .run();
            else insert.run();
          }
        }),
        assertQuestionAnswer: storeMutation({
          input: Schema.Struct({ requestId: Schema.String }),
          output: Schema.Void,
          run: (input) => {
            const receipt = db.orm
              .select()
              .from(conversation_question_answers)
              .where(eq(conversation_question_answers.request_id, input.requestId))
              .get();

            if (!receipt || !receipt.question_guard) return;

            const version = db.orm
              .select()
              .from(message_versions)
              .where(eq(message_versions.id, receipt.version_id))
              .get();

            if (!version) throw new StudyError('invalid_input', 'Question is unavailable');

            const { row } = current({
              messageId: version.message_id,
              expectedActiveVersionId: version.id
            });

            if (row.question_kind !== 'question')
              throw new StudyError('invalid_input', 'Question classification changed');
          }
        })
      }
    };
  }
});

/** Resolves an available user note while fencing stale or deleting session identities. */
function makeCurrent({ db }: Pick<StoreResources, 'db'>) {
  const isTextQuestion = (
    row: typeof messages.$inferSelect | undefined
  ): row is typeof messages.$inferSelect => !!row && row.role === 'user' && row.format === 'text';

  function isAnswerSelection(
    row: typeof messages.$inferSelect,
    version: typeof message_versions.$inferSelect
  ) {
    const active = db.orm
      .select()
      .from(message_versions)
      .where(eq(message_versions.id, row.active_version_id!))
      .get();

    return (
      row.question_version_id === version.id &&
      active?.message_id === row.id &&
      active.origin === 'answer' &&
      active.based_on === version.id
    );
  }

  const current = (input: typeof questionVersionInputSchema.Type) => {
    const row = db.orm
      .select()
      .from(messages)
      .where(and(eq(messages.id, input.messageId), activeMessageCondition()))
      .get();

    if (
      !isTextQuestion(row) ||
      db.orm
        .select()
        .from(session_deletions)
        .where(eq(session_deletions.session_id, row.session_id))
        .get()
    )
      throw new StudyError('invalid_input', 'Question version is unavailable');

    const version = db.orm
      .select()
      .from(message_versions)
      .where(eq(message_versions.id, input.expectedActiveVersionId))
      .get();

    if (!version || version.message_id !== row.id || version.status !== 'complete')
      throw new StudyError('invalid_input', 'Question version is unavailable');

    if (row.active_version_id !== input.expectedActiveVersionId && !isAnswerSelection(row, version))
      throw new StudyError('invalid_input', 'Question version is unavailable');

    return { row, version };
  };

  return current;
}

export const QuestionAnswerStore = defineStore({
  name: 'study/ConversationQuestionAnswerStore',
  entity: { singular: 'questionAnswer', plural: 'questionAnswers' },
  make: ({ db }) => {
    const current = makeCurrent({ db });

    return {
      queries: {
        findQuestionAnswer: storeQuery({
          role: 'optional',
          input: questionVersionInputSchema,
          output: Schema.Option(replyRequestSchema),
          run: (input) => {
            const { row } = current(input);

            if (
              row.question_kind !== 'question' ||
              row.question_version_id !== input.expectedActiveVersionId
            )
              throw new StudyError('invalid_input', 'Message is not a question');

            const receipt = db.orm
              .select()
              .from(conversation_question_answers)
              .where(eq(conversation_question_answers.version_id, input.expectedActiveVersionId))
              .get();

            if (!receipt) return Option.none();

            const answer = db.orm
              .select()
              .from(messages)
              .where(eq(messages.id, receipt.answer_message_id))
              .get();

            return answer?.active_version_id
              ? Option.some({
                  requestId: receipt.request_id,
                  sessionId: row.session_id,
                  messageId: receipt.answer_message_id,
                  versionId: receipt.answer_version_id
                })
              : Option.none();
          }
        })
      },
      mutations: {}
    };
  }
});
