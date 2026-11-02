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
import type { MessageId, SessionId } from '@study/contracts/ids';
import {
  citedMarkers,
  renumberCitations,
  validateCitations
} from '@study/contracts/sources/citations';
import { and, asc, desc, eq, isNull, lt, sql } from '@study/db';
import {
  citations,
  message_parts,
  message_versions,
  messages,
  sessions,
  sources
} from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

import { makePersistence } from './persistence.ts';
import { makeThread } from './thread.ts';

function textOf(value: string, allowEmpty = false) {
  const text = value.trim();

  if ((!allowEmpty && !text) || [...text].length > 100_000)
    throw new StudyError('invalid_input', 'invalid message text');

  return text;
}

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
        precision:
          c.material_version_id !== null &&
          c.document_id !== null &&
          c.block_id !== null &&
          c.range_start !== null &&
          c.range_end !== null
            ? ('exact' as const)
            : ('approximate' as const),
        support: { state: 'unassessed' as const },
        marker: Number(c.marker),
        sourceId: c.source_id,
        materialVersionId: c.material_version_id,
        documentId: c.document_id,
        blockId: c.block_id,
        rangeStart: c.range_start === null ? null : Number(c.range_start),
        rangeEnd: c.range_end === null ? null : Number(c.range_end),
        sourceName: c.source_name,
        anchor: Schema.decodeUnknownSync(anchorSchema)(JSON.parse(c.anchor)),
        quote: c.quote
      }));
  }

  function read(id: MessageId) {
    const m = db.orm.select().from(messages).where(eq(messages.id, id)).get();

    if (!m) return null;

    return {
      id: m.id,
      sessionId: m.session_id,
      role: m.role,
      threadRoot: m.thread_root,
      replyTo: m.reply_to,
      activeVersionId: m.active_version_id,
      recordingId: m.recording_id,
      recordingMs: m.recording_ms,
      recordedIn: m.recorded_in,
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
          text: v.text,
          basedOn: v.based_on,
          instruction: v.instruction,
          createdAt: v.created_at
        })),
      parts: db.orm
        .select()
        .from(message_parts)
        .where(eq(message_parts.message_id, id))
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

  return { read, required, touch, assertThreadRoot, readCitations };
}

export const MessageStore = defineStore({
  name: 'study/ConversationMessageStore',
  entity: { singular: 'message', plural: 'messages' },
  make: ({ db, clock }) => {
    const { requiredSession, insertSelectedVersion } = makePersistence({ db, clock });
    const { read, required, touch, assertThreadRoot } = makeHelpers({ db, clock });

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
        editMessage: storeMutation({
          input: editMessageInputSchema,
          output: chatMessageSchema,
          run: (input) => {
            const message = required(input.messageId);
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
                  material_version_id: citation.materialVersionId,
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
              .set({ active_version_id: version.id })
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

            db.orm
              .update(messages)
              .set({ active_version_id: input.versionId })
              .where(eq(messages.id, message.id))
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
