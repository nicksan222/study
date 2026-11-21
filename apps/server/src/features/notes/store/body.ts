/** @file Persists a notebook body as selected versions of one authored message. */

import {
  notebookBodyCaptureKey,
  noteBodyInputSchema,
  noteBodySchema,
  saveNoteBodyInputSchema,
  StudyError
} from '@study/contracts';
import type { MessageId, VersionId } from '@study/contracts';
import { desc, eq, message_versions, messages } from '@study/db';
import { defineStore, storeMutation, storeQuery, unixSeconds } from '@study/server';

import { makeHistory } from './history.ts';
import { makeHelpers } from './message-rows.ts';
import { makePersistence } from './persistence.ts';

export const NoteBodyStore = defineStore({
  name: 'study/NoteBodyStore',
  entity: { singular: 'noteBody', plural: 'noteBodies' },
  make: (resources) => {
    const { db, timestampClock } = resources;
    const { notebookBody, notebookBodyFallback } = makeHistory(resources);
    const { insertSelectedVersion } = makePersistence(resources);
    const { touch } = makeHelpers(resources);

    function appendBodyVersion(
      messageId: MessageId,
      text: string,
      basedOn: VersionId | null,
      createdAt: bigint
    ) {
      const latest = db.orm
        .select({ number: message_versions.number })
        .from(message_versions)
        .where(eq(message_versions.message_id, messageId))
        .orderBy(desc(message_versions.number))
        .limit(1)
        .get();

      return insertSelectedVersion({
        message_id: messageId,
        number: (latest?.number ?? 0n) + 1n,
        origin: basedOn === null ? 'typed' : 'edited',
        status: 'complete',
        text,
        based_on: basedOn,
        created_at: createdAt
      });
    }

    return {
      queries: {
        body: storeQuery({
          role: 'required',
          input: noteBodyInputSchema,
          output: noteBodySchema,
          run: ({ noteId }) => {
            const current = notebookBody(noteId);

            return current
              ? { text: current.text, versionId: current.versionId }
              : { text: notebookBodyFallback(noteId), versionId: null };
          }
        })
      },
      mutations: {
        saveBody: storeMutation({
          changes: ['notes'],
          input: saveNoteBodyInputSchema,
          output: noteBodySchema,
          run: ({ noteId, text, expectedVersionId }) => {
            const current = notebookBody(noteId);

            if (current?.text === text) return { text, versionId: current.versionId };

            const basedOn = current?.versionId ?? null;

            if (basedOn !== expectedVersionId)
              throw new StudyError('invalid_input', 'Notebook body version changed');

            const createdAt = unixSeconds(timestampClock);
            const messageId =
              current?.messageId ??
              db.orm
                .insert(messages)
                .values({
                  note_id: noteId,
                  role: 'user',
                  capture_key: notebookBodyCaptureKey,
                  created_at: createdAt
                })
                .returning({ id: messages.id })
                .get().id;
            const version = appendBodyVersion(messageId, text, basedOn, createdAt);

            touch(noteId);

            return { text, versionId: version.id };
          }
        })
      }
    };
  }
});
