/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies automatic note inclusion and reversible item archiving.                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises archive ownership, restoration, immutable captures and bounded reads.        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use real SQLite fixtures and public feature services exclusively.                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { Notes } from '#server/features/notes/index';
import { Pages } from '#server/features/pages/index';
import { Sources } from '#server/features/sources/index';
import { deletionDocument } from '#testing/material-deletion';
import { pageTransformFixture } from '#testing/page-transform';

testStable(
  'automatically includes active note items, archives reversibly, and preserves captured requests',
  async () => {
    const f = await pageTransformFixture();

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const notes = yield* Notes;
          const documents = yield* Pages;
          const first = yield* notes.createNote({ title: 'First' });
          const second = yield* notes.createNote({ title: 'Other' });
          const noteMessage = yield* notes.postMessage({
            noteId: first.id,
            text: 'Note note',
            requestReply: false
          });
          const doc = yield* documents.create({
            noteId: first.id,
            createKey: crypto.randomUUID(),
            title: 'Shared document',
            inputs: [],
            citations: [],
            document: deletionDocument('Document evidence')
          });

          yield* documents.attach({ noteId: second.id, pageId: doc.id });
          const capture = () =>
            notes.captureNoteContext({
              noteId: first.id,
              intentKey: crypto.randomUUID(),
              instruction: '',
              preferences: {}
            });
          const before = yield* capture();

          expect(before.messages.map((x) => x.text)).toEqual(['Note note']);
          expect(before.inputs.map((x) => x.name)).toEqual(['Shared document']);

          yield* notes.setItemArchived({
            noteId: first.id,
            target: { kind: 'message', id: noteMessage.id },
            archived: true
          });
          yield* notes.setItemArchived({
            noteId: first.id,
            target: { kind: 'page', id: doc.id },
            archived: true
          });
          expect((yield* notes.thread({ noteId: first.id, limit: 30 })).items).toHaveLength(0);
          expect(
            (yield* documents.pages({ noteId: first.id, archived: false, limit: 30 })).items
          ).toHaveLength(0);
          expect(
            (yield* documents.pages({ noteId: second.id, archived: false, limit: 30 })).items
          ).toHaveLength(1);
          expect(
            (yield* notes.archivedItems({ noteId: first.id })).map((x) => x.target.kind).sort()
          ).toEqual(['message', 'page']);
          const empty = yield* Effect.flip(capture());

          expect(empty.kind).toBe('invalid_input');
          expect(
            (yield* notes.inspectNoteContext({
              requestId: before.requestId
            })).messages.map((x) => x.text)
          ).toEqual(['Note note']);

          yield* notes.setItemArchived({
            noteId: first.id,
            target: { kind: 'message', id: noteMessage.id },
            archived: false
          });
          yield* notes.setItemArchived({
            noteId: first.id,
            target: { kind: 'page', id: doc.id },
            archived: false
          });
          expect(yield* notes.archivedItems({ noteId: first.id })).toHaveLength(0);
          expect((yield* capture()).inputs).toHaveLength(1);

          yield* notes.setItemArchived({
            noteId: first.id,
            target: { kind: 'message', id: noteMessage.id },
            archived: true
          });
          yield* notes.deleteMessage(noteMessage.id);
          expect(yield* notes.archivedItems({ noteId: first.id })).toHaveLength(0);
        }).pipe(Effect.provide(f.domain()))
      );
    } finally {
      await f.close();
    }
  }
);

testStable(
  'source archive is note-scoped and pending active material is never silently omitted',
  async () => {
    const f = await pageTransformFixture();

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const notes = yield* Notes;
          const sources = yield* Sources;
          const first = yield* notes.createNote({ title: 'First' });
          const second = yield* notes.createNote({ title: 'Second' });
          const source = yield* sources.createSource({
            name: 'evidence.txt',
            bytes: new TextEncoder().encode('Evidence'),
            projectId: null
          });

          yield* notes.postMessage({
            noteId: first.id,
            text: '',
            sourceIds: [source.id],
            requestReply: false
          });
          yield* notes.postMessage({
            noteId: second.id,
            text: '',
            sourceIds: [source.id],
            requestReply: false
          });
          yield* notes.setItemArchived({
            noteId: first.id,
            target: { kind: 'source', id: source.id },
            archived: true
          });
          expect(
            (yield* notes.thread({ noteId: first.id, limit: 30 })).items[0]?.parts
          ).toHaveLength(0);
          expect(
            (yield* notes.thread({ noteId: second.id, limit: 30 })).items[0]?.parts
          ).toHaveLength(1);
          expect((yield* sources.source(source.id)).id).toBe(source.id);
          expect((yield* notes.archivedItems({ noteId: first.id }))[0]?.target).toEqual({
            kind: 'source',
            id: source.id
          });
          yield* notes.captureNoteContext({
            noteId: first.id,
            intentKey: 'archived',
            instruction: '',
            preferences: {}
          });
          yield* notes.setItemArchived({
            noteId: first.id,
            target: { kind: 'source', id: source.id },
            archived: false
          });
          const failure = yield* Effect.flip(
            notes.captureNoteContext({
              noteId: first.id,
              intentKey: 'restored-pending',
              instruction: '',
              preferences: {}
            })
          );

          expect(failure.kind).toBe('not_enough');
        }).pipe(Effect.provide(f.domain()))
      );
    } finally {
      await f.close();
    }
  }
);

testStable('archive mutation rejects an item owned by another note', async () => {
  const f = await pageTransformFixture();

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const notes = yield* Notes;
        const first = yield* notes.createNote({ title: 'First' });
        const second = yield* notes.createNote({ title: 'Second' });
        const noteMessage = yield* notes.postMessage({
          noteId: second.id,
          text: 'Other note',
          requestReply: false
        });
        const failure = yield* Effect.flip(
          notes.setItemArchived({
            noteId: first.id,
            target: { kind: 'message', id: noteMessage.id },
            archived: true
          })
        );

        expect(failure.kind).toBe('not_found');
        expect((yield* notes.thread({ noteId: second.id, limit: 30 })).items).toHaveLength(1);
      }).pipe(Effect.provide(f.domain()))
    );
  } finally {
    await f.close();
  }
});

testStable('empty archives load and bounded reads retain every archived item', async () => {
  const f = await pageTransformFixture();

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const notes = yield* Notes;
        const note = yield* notes.createNote({ title: 'Archive pages' });

        expect(yield* notes.archivedItems({ noteId: note.id })).toEqual([]);
        const ids = [];

        for (let i = 0; i < 101; i++) {
          const noteMessage = yield* notes.postMessage({
            noteId: note.id,
            text: 'Archived note ' + i,
            requestReply: false
          });

          ids.push(noteMessage.id);
          yield* notes.setItemArchived({
            noteId: note.id,
            target: { kind: 'message', id: noteMessage.id },
            archived: true
          });
        }

        const items = yield* notes.archivedItems({ noteId: note.id });

        expect(items).toHaveLength(101);
        expect(new Set(items.map((item) => item.target.id))).toEqual(new Set(ids));
      }).pipe(Effect.provide(f.domain()))
    );
  } finally {
    await f.close();
  }
});
