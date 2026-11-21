/** @file Owns context within this feature. */

import {
  StudyError,
  noteContextIntentSchema,
  replySnapshotInputSchema,
  resolvedSelectionSchema,
  runSelectionContextSchema
} from '@study/contracts';
import {
  eq,
  message_parts,
  messages,
  note_context_pages,
  note_context_sources,
  note_run_contexts
} from '@study/db';
import { defineStore, storeMutation, storeQuery } from '@study/server';
import { Option, Schema } from 'effect';

import { makeContextReads } from './context-reads.ts';
import { assertHistoryBoundary, contextCodec, intentCodec } from './context-schemas.ts';
import { makeHistory } from './history.ts';

export const NoteContextStore = defineStore({
  name: 'study/NoteContextStore',
  entity: { singular: 'noteContext', plural: 'noteContexts' },
  make: (resources) => {
    const { db } = resources;

    const { note, requiredContext, retainedContext, decodeContext, assertContextAvailable } =
      makeContextReads(resources);

    const { noteHistory, noteRoot, notebookBody } = makeHistory(resources);

    function captureHistory(
      input: typeof noteContextIntentSchema.Type & { authoredOnly?: boolean }
    ) {
      if (input.authoredOnly) {
        const body = notebookBody(input.noteId);

        if (body) return [body];
      }

      let history = noteHistory(input.noteId, input.throughMessageId, input.threadRoot, true, {
        authoredOnly: input.authoredOnly,
        pendingAssistant: input.throughMessageId !== undefined ? 'omit' : undefined
      });

      if (input.threadRoot !== undefined) {
        const part = db.orm
          .select()
          .from(message_parts)
          .where(eq(message_parts.id, input.threadRoot))
          .get();

        if (!part) throw new StudyError('not_found', 'Thread root is unavailable');

        const root = noteRoot(input.noteId, part.message_id);
        const size = root.text.length + history.reduce((n, item) => n + item.text.length, 0);

        if (size > 200000) throw new StudyError('not_enough', 'Thread context exceeds limit');

        history = [root, ...history];
      }

      assertHistoryBoundary(history, input.throughMessageId);

      return history;
    }

    return {
      queries: {
        noteContext: storeQuery({
          role: 'required',
          input: replySnapshotInputSchema,
          output: runSelectionContextSchema,
          run: ({ requestId }) => requiredContext(requestId, true)
        }),
        findNoteContext: storeQuery({
          role: 'optional',
          input: replySnapshotInputSchema,
          output: Schema.Option(runSelectionContextSchema),
          run: ({ requestId }) => {
            assertContextAvailable(requestId);

            const row = retainedContext(requestId);

            return row ? Option.some(decodeContext(row.snapshot)) : Option.none();
          }
        })
      },
      mutations: {
        capture: storeMutation({
          changes: ['notes'],
          input: Schema.Struct({
            ...noteContextIntentSchema.fields,
            requestId: Schema.String,
            authoredOnly: Schema.optional(Schema.Boolean),
            inputs: Schema.Array(resolvedSelectionSchema)
          }),
          output: runSelectionContextSchema,
          run: (input) => {
            const row = note(input.noteId);

            const captured = captureHistory(input);
            let history = input.authoredOnly
              ? captured.filter((item) => item.text.trim())
              : captured;

            const total = db.orm
              .select()
              .from(messages)
              .where(eq(messages.note_id, row.id))
              .all().length;

            const includedNotes = input.additionalNoteIds?.map((noteId) => {
              const included = note(noteId);

              history = [...history, ...noteHistory(noteId, undefined, undefined, true)];

              return {
                noteId,
                title: included.title,
                selectionRevision: included.selection_revision
              };
            });

            if (history.reduce((size, item) => size + item.text.length, 0) > 200000)
              throw new StudyError('not_enough', 'Combined note context exceeds limit');

            const intent = {
              additionalNoteIds: input.additionalNoteIds,
              noteId: input.noteId,
              intentKey: input.intentKey,
              instruction: input.instruction,
              preferences: input.preferences,
              threadRoot: input.threadRoot,
              throughMessageId: input.throughMessageId,
              askDigest: input.askDigest
            };

            const snapshot = {
              ...intent,
              requestId: input.requestId,
              selectionRevision: row.selection_revision,
              inputs: input.inputs,
              messages: history,
              includedNotes,
              excludedMessages:
                total +
                (input.additionalNoteIds ?? []).reduce(
                  (count, id) =>
                    count +
                    db.orm.select().from(messages).where(eq(messages.note_id, id)).all().length,
                  0
                ) -
                history.length
            };

            if (!history.length && !input.inputs.length)
              throw new StudyError('invalid_input', 'Context has no selected input or note');

            db.orm
              .insert(note_run_contexts)
              .values({
                request_id: input.requestId,
                note_id: row.id,
                intent_key: input.intentKey,
                intent: Schema.encodeSync(intentCodec)(intent),
                snapshot: Schema.encodeSync(contextCodec)(snapshot)
              })
              .run();

            for (const selected of input.inputs) {
              const reference = selected.input;

              if (reference.kind === 'page')
                db.orm
                  .insert(note_context_pages)
                  .values({ request_id: input.requestId, version_id: reference.versionId })
                  .onConflictDoNothing()
                  .run();
              else
                db.orm
                  .insert(note_context_sources)
                  .values({
                    request_id: input.requestId,
                    source_id: reference.sourceId,
                    revision: reference.revision,
                    snapshot_id: reference.snapshotId
                  })
                  .onConflictDoNothing()
                  .run();
            }

            return snapshot;
          }
        })
      }
    };
  }
});
