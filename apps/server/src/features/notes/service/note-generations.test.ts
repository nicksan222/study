/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises durable bounded request discovery after restart and retirement.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks persisted request ownership, stable cursors and content-free retirement reads.  │
 * │ - Uses database fixtures to verify service-visible invariants and failures.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite uses real SQLite fixtures and service dependencies; domain state remains owned │
 * │ by the feature implementation.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { NotesRpc } from '@study/contracts/notes/rpc';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Notes } from '#server/features/notes/index';
import { NotesRpcLive } from '#server/features/notes/rpc/index';
import { Pages } from '#server/features/pages/index';
import { deletionDocument } from '#testing/material-deletion';
import { cleanup } from '#testing/note-deletion';
import { pageTransformFixture } from '#testing/page-transform';

testStable(
  'note generation RPC discovers bounded exact requests across reopen, cancellation and note retirement',
  async () => {
    const fixture = await pageTransformFixture();

    try {
      const setup = await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Notes;
          const documents = yield* Pages;
          const note = yield* chats.createNote({ title: 'Discover' });
          const other = yield* chats.createNote({ title: 'Other' });
          const input = yield* documents.create({
            createKey: 'discovery-input',
            inputs: [],
            citations: [],
            title: 'Input',
            noteId: note.id,
            document: deletionDocument('Retained discovery evidence')
          });

          assert.ok(input.version);
          yield* chats.updateNoteSelection({
            noteId: note.id,
            expectedRevision: 0n,
            targets: [
              {
                input: { kind: 'page', versionId: input.version.id },
                scope: { kind: 'document' }
              }
            ]
          });
          const noteMessage = yield* chats.postMessage({
            noteId: note.id,
            text: 'Captured context'
          });
          const requests = [];

          for (const intentKey of ['first', 'second', 'third']) {
            const capture = yield* chats.captureNoteContext({
              noteId: note.id,
              intentKey,
              instruction: 'Private discovery instruction',
              preferences: {}
            });
            const request = yield* chats.requestPageTransform({
              contextRequestId: capture.requestId,
              title: 'Transform',
              operations: ['clarity']
            });

            requests.push({ requestId: request.id, contextRequestId: capture.requestId });
          }

          return {
            note,
            noteMessage,
            other,
            input,
            requests: requests.sort((a, b) => (a.requestId < b.requestId ? 1 : -1))
          };
        }).pipe(Effect.provide(fixture.domain()))
      );

      await fixture.reopen();
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(NotesRpc, { flatten: true });
            const first = yield* rpc('notes.noteGenerations', {
              noteId: setup.note.id,
              limit: 1
            });

            assert.strictEqual(first.items[0]?.requestId, setup.requests[0]!.requestId);
            assert.strictEqual(
              first.items[0]?.contextRequestId,
              setup.requests[0]!.contextRequestId
            );
            assert.ok(first.items[0]?.state === 'available');
            assert.strictEqual(first.next, setup.requests[0]!.requestId);
            const rest = yield* rpc('notes.noteGenerations', {
              noteId: setup.note.id,
              limit: 2,
              before: first.next!
            });

            expect(rest.items.map((i) => i.requestId)).toStrictEqual(
              setup.requests.slice(1).map((i) => i.requestId)
            );
            assert.ok(rest.next === null);
            expect(
              (yield* rpc('notes.noteGenerations', {
                noteId: setup.other.id,
                limit: 100
              })).items
            ).toStrictEqual([]);
          }).pipe(Effect.provide(NotesRpcLive.pipe(Layer.provideMerge(fixture.domain()))))
        )
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Notes;

          yield* chats.editMessage({
            messageId: setup.noteMessage.id,
            text: 'Changed after capture'
          });
          const page = yield* chats.noteGenerations({ noteId: setup.note.id, limit: 100 });

          assert.ok(page.items.every((item) => item.state === 'available'));
          expect(page.items.map((item) => item.requestId)).toStrictEqual(
            setup.requests.map((item) => item.requestId)
          );
        }).pipe(Effect.provide(fixture.domain()))
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Pages;
          const chats = yield* Notes;

          assert.ok((yield* docs.previewDeletion({ id: setup.input.id })).blockedVersionIds.length);
          yield* docs.cancelTransform({ requestId: setup.requests[0]!.requestId });
          const page = yield* chats.noteGenerations({ noteId: setup.note.id, limit: 100 });

          assert.ok(page.items[0]?.cancelled === true);
          assert.ok(page.items.every((item) => item.state === 'available'));
          yield* chats.deleteNote(setup.note.id);
        }).pipe(Effect.provide(fixture.domain()))
      );
      await cleanup(fixture, setup.note.id);
      await fixture.reopen();
      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Notes;

          assert.ok(
            (yield* Effect.flip(chats.noteGenerations({ noteId: setup.note.id, limit: 100 })))
              .kind === 'not_found'
          );
          const docs = yield* Pages;
          const retained = yield* docs.page({ id: setup.input.id });

          assert.ok(retained.version);
          assert.ok(retained.version.document.blocks[0]?.text === 'Retained discovery evidence');
        }).pipe(Effect.provide(fixture.domain()))
      );
    } finally {
      await fixture.close();
    }
  }
);
