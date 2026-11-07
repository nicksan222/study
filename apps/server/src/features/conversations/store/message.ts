/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists and retrieves individual conversation messages.                           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Enforces message version and ordering rules in database queries and mutations.         │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the conversations service applies policy and    │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import {
  messageVersionCitationsSchema,
  updateMessageDescriptionInputSchema,
  editMessageInputSchema,
  postMessageInputSchema,
  setActiveVersionInputSchema,
  threadInputSchema
} from '@study/contracts/conversations/rpc';
import {
  replyVersionInputSchema,
  anchorSchema,
  chatMessageSchema
} from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { messageIdSchema } from '@study/contracts/ids';
import type { MessageId, SessionId, VersionId } from '@study/contracts/ids';
import {
  citedMarkers,
  renumberCitations,
  validateCitations
} from '@study/contracts/sources/citations';
import { and, asc, desc, eq, isNull, lt, sql } from '@study/db';
import {
  conversation_question_answers,
  citations,
  message_parts,
  message_versions,
  messages,
  sessions,
  session_deletions,
  sources
} from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

import { activeMessageCondition } from './archive.ts';
import { makePersistence } from './persistence.ts';
import { makeThread } from './thread.ts';

/** Carries manual corrections across versions while invalidating automatic results for changed content. */
function questionSelection(message: typeof chatMessageSchema.Type, versionId: VersionId) {
  const retained =
    message.question &&
    (message.question.versionId === versionId || message.question.answerVersionId === versionId);
  const carry = retained || message.question?.origin === 'manual';

  return {
    active_version_id: versionId,
    question_kind: carry ? message.question!.kind : null,
    question_origin: carry ? message.question!.origin : null,
    question_version_id: retained ? message.question!.versionId : carry ? versionId : null
  };
}

function textOf(value: string, allowEmpty = false) {
  const text = value.trim();

  if ((!allowEmpty && !text) || [...text].length > 100_000)
    throw new StudyError('invalid_input', 'invalid message text');

  return text;
}

type CitationRow = typeof citations.$inferSelect;

function citationInput(row: CitationRow) {
  if (row.authored_version_id !== null)
    return { kind: 'document' as const, versionId: row.authored_version_id };

  if (row.source_id !== null && row.source_revision !== null && row.document_id !== null)
    return {
      kind: 'source' as const,
      sourceId: row.source_id,
      revision: row.source_revision,
      snapshotId: row.document_id
    };

  return null;
}

function citationPrecision(row: CitationRow) {
  return citationInput(row) !== null &&
    row.document_id !== null &&
    row.block_id !== null &&
    row.range_start !== null &&
    row.range_end !== null
    ? ('exact' as const)
    : ('approximate' as const);
}

/** Binds message reads and version projections to the current database and clock. */
function makeHelpers({ db, clock }: StoreResources) {
  const { assertThreadRoot } = makeThread({ db, clock });

  function readCitations(versionId: typeof message_versions.$inferSelect.id) {
    return db.orm
      .select()
      .from(citations)
      .where(eq(citations.version_id, versionId))
      .orderBy(asc(citations.marker))
      .all()
      .map((c) => ({
        origin: 'agent' as const,
        precision: citationPrecision(c),
        support: { state: 'unassessed' as const },
        marker: Number(c.marker),
        sourceId: c.source_id,
        input: citationInput(c),
        documentId: c.document_id,
        blockId: c.block_id,
        rangeStart: c.range_start === null ? null : Number(c.range_start),
        rangeEnd: c.range_end === null ? null : Number(c.range_end),
        sourceName: c.source_name,
        anchor: Schema.decodeUnknownSync(anchorSchema)(JSON.parse(c.anchor)),
        quote: c.quote
      }));
  }

  /** Reads classification, answer linkage and immutable versions from the same database state. */
  function read(id: MessageId) {
    const m = db.orm.select().from(messages).where(eq(messages.id, id)).get();

    if (!m) return null;

    const answer = m.question_version_id
      ? db.orm
          .select({
            messageId: conversation_question_answers.answer_message_id,
            versionId: conversation_question_answers.answer_version_id,
            requestId: conversation_question_answers.request_id,
            archivedAt: messages.archived_at
          })
          .from(conversation_question_answers)
          .leftJoin(messages, eq(messages.id, conversation_question_answers.answer_message_id))
          .where(eq(conversation_question_answers.version_id, m.question_version_id))
          .get()
      : undefined;

    const question = () =>
      m.question_kind && m.question_origin && m.question_version_id
        ? {
            kind: m.question_kind,
            origin: m.question_origin,
            versionId: m.question_version_id,
            answerMessageId: answer?.messageId,
            answerVersionId: answer?.versionId,
            answerRequestId: answer?.requestId,
            answerArchived: answer?.archivedAt != null
          }
        : undefined;

    return {
      question: question(),
      id: m.id,
      sessionId: m.session_id,
      role: m.role,
      threadRoot: m.thread_root,
      replyTo: m.reply_to,
      activeVersionId: m.active_version_id,
      recordingId: m.recording_id,
      recordingMs: m.recording_ms,
      recordedIn: m.recorded_in,
      captureKey: m.capture_key,
      format: m.format,
      description: m.description,
      createdAt: m.created_at,
      versions: db.orm
        .select()
        .from(message_versions)
        .where(eq(message_versions.message_id, id))
        .orderBy(asc(message_versions.number))
        .all()
        .map((v) => ({
          id: v.id,
          number: v.number,
          origin: v.origin,
          status: v.status,
          ...(v.status === 'failed' && v.generation_request_id !== null
            ? { generationRequestId: v.generation_request_id }
            : {}),
          text: v.text,
          basedOn: v.based_on,
          instruction: v.instruction,
          createdAt: v.created_at
        })),
      parts: db.orm
        .select()
        .from(message_parts)
        .where(
          and(
            eq(message_parts.message_id, id),
            sql`NOT EXISTS (
          SELECT 1 FROM session_sources archived_source
          WHERE archived_source.session_id=${m.session_id}
          AND archived_source.source_id=${message_parts.source_id}
          AND archived_source.archived_at IS NOT NULL
        )`
          )
        )
        .orderBy(asc(message_parts.ordinal))
        .all()
        .map((p) => ({
          id: p.id,
          sourceId: p.source_id,
          sourceName: p.source_name,
          sourceKind: p.source_kind
        })),
      citations: m.active_version_id === null ? [] : readCitations(m.active_version_id)
    };
  }

  function required(id: MessageId) {
    const value = read(id);

    if (!value) throw new StudyError('not_found', 'message not found');

    return value;
  }

  function touch(id: SessionId) {
    db.orm
      .update(sessions)
      .set({
        updated_at: unixSeconds(clock),
        context_revision: sql`${sessions.context_revision} + 1`
      })
      .where(eq(sessions.id, id))
      .run();
  }

  /** Replays text-only note creation without duplicating a page or generation request. */
  function capturedNote(input: typeof postMessageInputSchema.Type) {
    if (!input.captureKey) return null;

    if (input.requestReply !== false || input.sourceIds?.length)
      throw new StudyError('invalid_input', 'capture keys require a text-only note');

    const row = db.orm
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(eq(messages.session_id, input.sessionId), eq(messages.capture_key, input.captureKey))
      )
      .get();

    if (!row) return null;

    const message = required(row.id);

    assertCaptureReplay(message, input);

    return message;
  }

  return { read, required, touch, assertThreadRoot, readCitations, capturedNote };
}

function assertCaptureReplay(
  message: typeof chatMessageSchema.Type,
  input: typeof postMessageInputSchema.Type
) {
  if (
    message.format !== (input.format ?? 'text') ||
    message.threadRoot !== (input.threadRoot ?? null) ||
    message.versions[0]?.text !== input.text.trim()
  )
    throw new StudyError('invalid_input', 'capture key already belongs to another note');
}

export const MessageStore = defineStore({
  name: 'study/ConversationMessageStore',
  entity: { singular: 'message', plural: 'messages' },
  make: ({ db, clock }) => {
    const { requiredSession, insertSelectedVersion } = makePersistence({ db, clock });
    const { read, required, touch, assertThreadRoot, capturedNote } = makeHelpers({ db, clock });

    return {
      queries: {
        message: storeQuery({
          role: 'required',
          input: messageIdSchema,
          output: chatMessageSchema,
          run: (id) => read(id)!
        }),
        messages: storeQuery({
          role: 'collection',
          input: threadInputSchema,
          output: Schema.Array(chatMessageSchema),
          run: (input) => {
            if (
              !db.orm
                .select({ id: sessions.id })
                .from(sessions)
                .where(eq(sessions.id, input.sessionId))
                .get()
            )
              throw new StudyError('not_found', 'session not found');

            if (input.threadRoot !== undefined) assertThreadRoot(input.sessionId, input.threadRoot);

            return db.orm
              .select({ id: messages.id })
              .from(messages)
              .where(
                and(
                  eq(messages.session_id, input.sessionId),
                  activeMessageCondition(),
                  input.threadRoot === undefined
                    ? isNull(messages.thread_root)
                    : eq(messages.thread_root, input.threadRoot),
                  input.before === undefined ? undefined : lt(messages.id, input.before)
                )
              )
              .orderBy(desc(messages.id))
              .limit(input.limit)
              .all()
              .reverse()
              .map((m) => required(m.id));
          }
        })
      },
      mutations: {
        postMessage: storeMutation({
          input: postMessageInputSchema,
          output: chatMessageSchema,
          run: (input) => {
            const session = requiredSession(input.sessionId);
            const captured = capturedNote(input);

            if (captured) return captured;

            if (input.threadRoot !== undefined) assertThreadRoot(session.id, input.threadRoot);

            const ids = input.sourceIds ?? [];
            const text = textOf(input.text, ids.length > 0);

            if (new Set(ids).size !== ids.length)
              throw new StudyError('invalid_input', 'duplicate attachment');

            const attachments = ids.map((id) => {
              const source = db.orm.select().from(sources).where(eq(sources.id, id)).get();

              if (!source) throw new StudyError('not_found', 'attachment not found');

              return source;
            });
            const message = db.orm
              .insert(messages)
              .values({
                session_id: session.id,
                capture_key: input.captureKey ?? null,
                format: input.format ?? 'text',
                role: 'user',
                thread_root: input.threadRoot ?? null,
                created_at: unixSeconds(clock)
              })
              .returning()
              .get();

            insertSelectedVersion({
              message_id: message.id,
              number: 1n,
              origin: 'typed',
              status: 'complete',
              text,
              created_at: unixSeconds(clock)
            });

            attachments.forEach((source, ordinal) =>
              db.orm
                .insert(message_parts)
                .values({
                  message_id: message.id,
                  ordinal: BigInt(ordinal),
                  source_id: source.id,
                  source_name: source.name,
                  source_kind: source.kind
                })
                .run()
            );
            touch(session.id);

            return required(message.id);
          }
        }),
        updateMessageDescription: storeMutation({
          input: updateMessageDescriptionInputSchema,
          output: chatMessageSchema,
          run: (input) => {
            const message = required(input.messageId);

            requiredSession(message.sessionId);

            if (message.role !== 'user')
              throw new StudyError('invalid_input', 'Only user notes have editable descriptions');

            if (
              db.orm
                .select()
                .from(session_deletions)
                .where(eq(session_deletions.session_id, message.sessionId))
                .get()
            )
              throw new StudyError('invalid_input', 'Session is being deleted');

            const description = input.description?.trim() || null;

            if (
              message.description !== input.expectedDescription &&
              message.description !== description
            )
              throw new StudyError('invalid_input', 'Message description changed');

            db.orm.update(messages).set({ description }).where(eq(messages.id, message.id)).run();
            touch(message.sessionId);

            return required(message.id);
          }
        }),
        editMessage: storeMutation({
          input: editMessageInputSchema,
          output: chatMessageSchema,
          run: (input) => {
            const message = required(input.messageId);

            if (
              input.expectedActiveVersionId !== undefined &&
              message.activeVersionId !== input.expectedActiveVersionId
            )
              throw new StudyError('invalid_input', 'active message version changed');

            let text = textOf(input.text);
            const markers = citedMarkers(text);
            const kept = message.citations.filter((citation) => markers.includes(citation.marker));

            validateCitations(kept);
            text = renumberCitations(
              text,
              message.citations.map((citation) => citation.marker),
              kept.map((citation) => citation.marker)
            );
            const number =
              message.versions.reduce((max, v) => (v.number > max ? v.number : max), 0n) + 1n;
            const version = db.orm
              .insert(message_versions)
              .values({
                message_id: message.id,
                number,
                origin: 'edited',
                status: 'complete',
                text,
                based_on: message.activeVersionId,
                created_at: unixSeconds(clock)
              })
              .returning()
              .get();

            for (const [index, citation] of kept.entries())
              db.orm
                .insert(citations)
                .values({
                  version_id: version.id,
                  marker: BigInt(index + 1),
                  source_id: citation.sourceId,
                  authored_version_id:
                    citation.input?.kind === 'document' ? citation.input.versionId : null,
                  source_revision:
                    citation.input?.kind === 'source' ? citation.input.revision : null,
                  document_id: citation.documentId,
                  block_id: citation.blockId,
                  range_start: citation.rangeStart == null ? null : BigInt(citation.rangeStart),
                  range_end: citation.rangeEnd == null ? null : BigInt(citation.rangeEnd),
                  source_name: citation.sourceName,
                  anchor: JSON.stringify(citation.anchor),
                  quote: citation.quote
                })
                .run();

            db.orm
              .update(messages)
              .set(questionSelection(message, version.id))
              .where(eq(messages.id, message.id))
              .run();
            touch(message.sessionId);

            return required(message.id);
          }
        }),
        setActiveVersion: storeMutation({
          input: setActiveVersionInputSchema,
          output: chatMessageSchema,
          run: (input) => {
            const message = required(input.messageId);

            if (!message.versions.some((v) => v.id === input.versionId && v.status === 'complete'))
              throw new StudyError('invalid_input', 'invalid message version');

            if (message.activeVersionId === input.versionId) return message;

            db.orm
              .update(messages)
              .set(questionSelection(message, input.versionId))
              .where(eq(messages.id, message.id))
              .run();
            touch(message.sessionId);

            return required(message.id);
          }
        }),
        deleteMessageVersion: storeMutation({
          input: setActiveVersionInputSchema,
          output: chatMessageSchema,
          run: (input) => {
            const message = required(input.messageId);
            const version = message.versions.find((item) => item.id === input.versionId);

            if (
              !version ||
              (version.status !== 'complete' &&
                !(version.origin === 'convert' && version.status === 'failed'))
            )
              throw new StudyError('invalid_input', 'Invalid message version');

            const remaining = message.versions.filter(
              (item) => item.id !== input.versionId && item.status === 'complete'
            );

            if (!remaining.length)
              throw new StudyError('invalid_input', 'Delete the item to remove its final version');

            if (message.activeVersionId === input.versionId)
              db.orm
                .update(messages)
                .set(questionSelection(message, remaining.at(-1)!.id))
                .where(eq(messages.id, message.id))
                .run();

            db.orm
              .delete(message_versions)
              .where(
                and(
                  eq(message_versions.id, input.versionId),
                  eq(message_versions.message_id, message.id)
                )
              )
              .run();
            touch(message.sessionId);

            return required(message.id);
          }
        }),
        deleteMessage: storeMutation({
          input: messageIdSchema,
          output: Schema.Boolean,
          run: (id) => {
            const message = read(id);

            if (!message) return false;

            db.orm.delete(messages).where(eq(messages.id, id)).run();
            touch(message.sessionId);

            return true;
          }
        })
      }
    };
  }
});

export const MessageVersionCitationsStore = defineStore({
  name: 'study/MessageVersionCitationsStore',
  entity: { singular: 'messageVersionCitations', plural: 'messageVersionCitationsPages' },
  make: (resources) => ({
    queries: {
      messageVersionCitations: storeQuery({
        role: 'required',
        input: replyVersionInputSchema,
        output: messageVersionCitationsSchema,
        run: (input) => {
          const helpers = makeHelpers(resources);
          const version = resources.db.orm
            .select({ id: message_versions.id })
            .from(message_versions)
            .innerJoin(messages, eq(messages.id, message_versions.message_id))
            .where(
              and(
                eq(messages.session_id, input.sessionId),
                eq(messages.id, input.messageId),
                eq(message_versions.id, input.versionId)
              )
            )
            .get();

          if (!version) throw new StudyError('not_found', 'Message version not found');

          return { ...input, citations: helpers.readCitations(input.versionId) };
        }
      })
    },
    mutations: {}
  })
});
