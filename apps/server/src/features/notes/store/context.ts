/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists guarded note selections and immutable logical note captures.              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Stores exact bounded message versions and typed captured intent.                       │
 * │ - Reads retained captures separately from availability-checked resume inputs.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Notes owns these private records; public content owners resolve canonical                │
 * │ selected content.                                                                        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import {
  noteContextIntentSchema,
  runSelectionContextSchema,
  noteSelectionInputSchema,
  noteSelectionSchema,
  updateNoteSelectionSchema,
  selectionTargetsSchema,
  resolvedSelectionSchema
} from '@study/contracts/notes/context';
import { replySnapshotInputSchema } from '@study/contracts/notes/schemas';
import { and, eq } from '@study/db';
import {
  notes,
  note_run_contexts,
  note_context_pages,
  note_context_sources,
  note_retired_intents,
  messages,
  message_parts,
  message_versions,
  note_deletions
} from '@study/db/schema';
import { Schema, Option } from 'effect';

import { defineStore, storeQuery, storeMutation } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeAssertContextAvailable } from './context-availability.ts';
import { makeHistory } from './history.ts';

const targetsCodec = Schema.fromJsonString(Schema.toCodecJson(selectionTargetsSchema));

const contextCodec = Schema.fromJsonString(Schema.toCodecJson(runSelectionContextSchema));

const intentCodec = Schema.fromJsonString(Schema.toCodecJson(noteContextIntentSchema));

const sameIntent = Schema.toEquivalence(noteContextIntentSchema);

function assertHistoryBoundary(
  history: typeof runSelectionContextSchema.Type.messages,
  throughMessageId: typeof noteContextIntentSchema.Type.throughMessageId
) {
  if (throughMessageId !== undefined && history.at(-1)?.messageId !== throughMessageId)
    throw new StudyError('invalid_input', 'Note boundary is unavailable in this scope');
}

function canonicalIntent(input: typeof noteContextIntentSchema.Type) {
  return {
    noteId: input.noteId,
    additionalNoteIds: input.additionalNoteIds,
    threadRoot: input.threadRoot,
    throughMessageId: input.askDigest ? undefined : input.throughMessageId,
    askDigest: input.askDigest,
    intentKey: input.intentKey,
    instruction: input.instruction,
    preferences: {
      language: input.preferences.language,
      detail: input.preferences.detail
    }
  };
}

function makeContextReads({ db, clock }: StoreResources) {
  function note(id: typeof noteSelectionInputSchema.Type.noteId) {
    const row = db.orm.select().from(notes).where(eq(notes.id, id)).get();

    if (!row) throw new StudyError('not_found', 'Note is unavailable');

    return row;
  }

  function selection(input: typeof noteSelectionInputSchema.Type) {
    const row = note(input.noteId);

    return {
      revision: row.selection_revision,
      targets: Schema.decodeUnknownSync(targetsCodec)(row.selection)
    };
  }

  function decodeContext(value: string) {
    const snapshot = Schema.decodeUnknownSync(contextCodec)(value);

    for (const id of [snapshot.noteId, ...(snapshot.additionalNoteIds ?? [])]) {
      if (db.orm.select().from(note_deletions).where(eq(note_deletions.note_id, id)).get())
        throw new StudyError('not_found', 'Captured note is unavailable');
    }

    for (const item of snapshot.messages) {
      const version = db.orm
        .select()
        .from(message_versions)
        .where(
          and(
            eq(message_versions.id, item.versionId),
            eq(message_versions.message_id, item.messageId)
          )
        )
        .get();

      if (!version || version.text !== item.text || version.status !== 'complete')
        throw new StudyError('not_found', 'Captured note version is unavailable');
    }

    return snapshot;
  }

  function retainedContext(requestId: string) {
    return db.orm
      .select()
      .from(note_run_contexts)
      .where(eq(note_run_contexts.request_id, requestId))
      .get();
  }

  const assertContextAvailable = makeAssertContextAvailable({ db, clock });

  function requiredContext(requestId: string, available: boolean) {
    assertContextAvailable(requestId, available);

    const row = retainedContext(requestId);

    if (!row) throw new StudyError('not_found', 'Captured context is unavailable');

    return available
      ? decodeContext(row.snapshot)
      : Schema.decodeUnknownSync(contextCodec)(row.snapshot);
  }

  return {
    note,
    selection,
    decodeContext,
    retainedContext,
    requiredContext,
    assertContextAvailable
  };
}

export const NoteSelectionStore = defineStore({
  name: 'study/NoteSelectionStore',
  entity: { singular: 'noteSelection', plural: 'noteSelections' },
  make: (resources) => {
    const { db } = resources;

    const { note, selection } = makeContextReads(resources);

    return {
      queries: {
        noteSelection: storeQuery({
          role: 'required',
          input: noteSelectionInputSchema,
          output: noteSelectionSchema,
          run: selection
        })
      },
      mutations: {
        updateSelection: storeMutation({
          input: updateNoteSelectionSchema,
          output: noteSelectionSchema,
          run: (input) => {
            const row = note(input.noteId);

            if (row.selection_revision !== input.expectedRevision)
              throw new StudyError('invalid_input', 'Note selection changed');

            db.orm
              .update(notes)
              .set({
                selection_revision: row.selection_revision + 1n,
                selection: Schema.encodeSync(targetsCodec)(input.targets)
              })
              .where(
                and(
                  eq(notes.id, input.noteId),
                  eq(notes.selection_revision, input.expectedRevision)
                )
              )
              .run();

            return selection(input);
          }
        })
      }
    };
  }
});

export const RetainedNoteContextStore = defineStore({
  name: 'study/RetainedNoteContextStore',
  entity: { singular: 'retainedNoteContext', plural: 'retainedNoteContexts' },
  make: (resources) => {
    const { requiredContext } = makeContextReads(resources);

    return {
      queries: {
        retainedNoteContext: storeQuery({
          role: 'required',
          input: replySnapshotInputSchema,
          output: runSelectionContextSchema,
          run: ({ requestId }) => requiredContext(requestId, false)
        })
      },
      mutations: {}
    };
  }
});

export const NoteContextIntentStore = defineStore({
  name: 'study/NoteContextIntentStore',
  entity: { singular: 'noteContextIntent', plural: 'noteContextIntents' },
  make: (resources) => {
    const { db } = resources;

    const { decodeContext, assertContextAvailable } = makeContextReads(resources);

    return {
      queries: {
        findNoteContextIntent: storeQuery({
          role: 'optional',
          input: noteContextIntentSchema,
          output: Schema.Option(runSelectionContextSchema),
          run: (input) => {
            if (
              db.orm
                .select()
                .from(note_retired_intents)
                .where(
                  and(
                    eq(note_retired_intents.note_id, input.noteId),
                    eq(note_retired_intents.intent_key, input.intentKey)
                  )
                )
                .get()
            )
              throw new StudyError('not_found', 'Captured input history is unavailable');

            const row = db.orm
              .select()
              .from(note_run_contexts)
              .where(
                and(
                  eq(note_run_contexts.note_id, input.noteId),
                  eq(note_run_contexts.intent_key, input.intentKey)
                )
              )
              .get();

            if (!row) return Option.none();

            assertContextAvailable(row.request_id);

            if (
              !sameIntent(
                canonicalIntent(Schema.decodeUnknownSync(intentCodec)(row.intent)),
                canonicalIntent(input)
              )
            )
              throw new StudyError('invalid_input', 'Intent key already captures different work');

            return Option.some(decodeContext(row.snapshot));
          }
        })
      },
      mutations: {}
    };
  }
});

export const NoteContextStore = defineStore({
  name: 'study/NoteContextStore',
  entity: { singular: 'noteContext', plural: 'noteContexts' },
  make: (resources) => {
    const { db } = resources;

    const { note, requiredContext, retainedContext, decodeContext, assertContextAvailable } =
      makeContextReads(resources);

    const { noteHistory, noteRoot } = makeHistory(resources);

    function captureHistory(input: typeof noteContextIntentSchema.Type) {
      let history = noteHistory(
        input.noteId,
        input.throughMessageId,
        input.threadRoot,
        true,
        input.throughMessageId === undefined ? {} : { pendingAssistant: 'omit' }
      );

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
          input: Schema.Struct({
            ...noteContextIntentSchema.fields,
            requestId: Schema.String,
            inputs: Schema.Array(resolvedSelectionSchema)
          }),
          output: runSelectionContextSchema,
          run: (input) => {
            const row = note(input.noteId);

            let history = captureHistory(input);

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

/** Conservative validity for captured selection and active versions of relevant messages. */

export const NoteContextValidityStore = defineStore({
  name: 'study/NoteContextValidityStore',
  entity: { singular: 'noteContextValidity', plural: 'noteContextValidities' },
  make: (resources) => {
    const { db } = resources;

    const { requiredContext, note } = makeContextReads(resources);

    return {
      queries: {
        noteContextValidity: storeQuery({
          role: 'required',
          input: replySnapshotInputSchema,
          output: Schema.Boolean,
          run: ({ requestId }) => {
            const captured = requiredContext(requestId, true);

            const owner = note(captured.noteId);

            return (
              owner.selection_revision === captured.selectionRevision &&
              (captured.includedNotes ?? []).every(
                (item) => note(item.noteId).selection_revision === item.selectionRevision
              ) &&
              captured.messages.every(
                (item) =>
                  db.orm.select().from(messages).where(eq(messages.id, item.messageId)).get()
                    ?.active_version_id === item.versionId
              )
            );
          }
        })
      },
      mutations: {}
    };
  }
});
