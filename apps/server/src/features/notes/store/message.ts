/** @file Owns message within this feature. */

import type { VersionId } from '@study/contracts';
import {
  StudyError,
  chatMessageSchema,
  citedMarkers,
  editMessageInputSchema,
  messageIdSchema,
  postMessageInputSchema,
  renumberCitations,
  setActiveVersionInputSchema,
  threadInputSchema,
  updateMessageDescriptionInputSchema,
  validateCitations
} from '@study/contracts';
import {
  and,
  citations,
  desc,
  eq,
  isNull,
  lt,
  message_parts,
  message_versions,
  messages,
  note_deletions,
  notes,
  sources
} from '@study/db';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

import { activeMessageCondition } from './archive.ts';
import { makeHelpers } from './message-rows.ts';
import { makePersistence } from './persistence.ts';

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

export const MessageStore = defineStore({
  name: 'study/NoteMessageStore',
  entity: { singular: 'message', plural: 'messages' },
  make: ({ db, clock, timestampClock }) => {
    const { requiredNote, insertSelectedVersion } = makePersistence({ db, clock, timestampClock });
    const { read, required, touch, assertThreadRoot, capturedNote } = makeHelpers({
      db,
      clock,
      timestampClock
    });

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
              !db.orm.select({ id: notes.id }).from(notes).where(eq(notes.id, input.noteId)).get()
            )
              throw new StudyError('not_found', 'note not found');

            if (input.threadRoot !== undefined) assertThreadRoot(input.noteId, input.threadRoot);

            return db.orm
              .select({ id: messages.id })
              .from(messages)
              .where(
                and(
                  eq(messages.note_id, input.noteId),
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
          changes: ['notes'],
          input: postMessageInputSchema,
          output: chatMessageSchema,
          run: (input) => {
            const note = requiredNote(input.noteId);
            const captured = capturedNote(input);

            if (captured) return captured;

            if (input.threadRoot !== undefined) assertThreadRoot(note.id, input.threadRoot);

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
                note_id: note.id,
                capture_key: input.captureKey ?? null,
                format: input.format ?? 'text',
                role: 'user',
                thread_root: input.threadRoot ?? null,
                created_at: unixSeconds(timestampClock)
              })
              .returning()
              .get();

            insertSelectedVersion({
              message_id: message.id,
              number: 1n,
              origin: 'typed',
              status: 'complete',
              text,
              created_at: unixSeconds(timestampClock)
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
            touch(note.id);

            return required(message.id);
          }
        }),
        updateMessageDescription: storeMutation({
          changes: ['notes'],
          input: updateMessageDescriptionInputSchema,
          output: chatMessageSchema,
          run: (input) => {
            const message = required(input.messageId);

            requiredNote(message.noteId);

            if (message.role !== 'user')
              throw new StudyError('invalid_input', 'Only user notes have editable descriptions');

            if (
              db.orm
                .select()
                .from(note_deletions)
                .where(eq(note_deletions.note_id, message.noteId))
                .get()
            )
              throw new StudyError('invalid_input', 'Note is being deleted');

            const description = input.description?.trim() || null;

            if (
              message.description !== input.expectedDescription &&
              message.description !== description
            )
              throw new StudyError('invalid_input', 'Message description changed');

            db.orm.update(messages).set({ description }).where(eq(messages.id, message.id)).run();
            touch(message.noteId);

            return required(message.id);
          }
        }),
        editMessage: storeMutation({
          changes: ['notes'],
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
                created_at: unixSeconds(timestampClock)
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
                    citation.input?.kind === 'page' ? citation.input.versionId : null,
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
            touch(message.noteId);

            return required(message.id);
          }
        }),
        setActiveVersion: storeMutation({
          changes: ['notes'],
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
            touch(message.noteId);

            return required(message.id);
          }
        }),
        deleteMessageVersion: storeMutation({
          changes: ['notes'],
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
            touch(message.noteId);

            return required(message.id);
          }
        }),
        deleteMessage: storeMutation({
          changes: ['notes'],
          input: messageIdSchema,
          output: Schema.Boolean,
          run: (id) => {
            const message = read(id);

            if (!message) return false;

            db.orm.delete(messages).where(eq(messages.id, id)).run();
            touch(message.noteId);

            return true;
          }
        })
      }
    };
  }
});
