import { NotesRpc } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises note combined context behavior through real persistence                  │
 * │ boundaries.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies combined capture pins selected notes and shared sources, replays exactly      │
 * │   and retires on source-note deletion.                                                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { sql } from '@study/db';
import { test } from '@study/testing';
import { Effect } from 'effect';
import { Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Notes } from '#server/features/notes/index';
import { NotesRpcLive } from '#server/features/notes/rpc/index';
import { Pages } from '#server/features/pages/index';
import { testLiveQueries } from '#testing/live-queries';
import { deletionDocument } from '#testing/material-deletion';
import { pageTransformFixture } from '#testing/page-transform';

test.stable(
  'combined capture pins selected notes and shared sources, replays exactly and retires on source-note deletion',
  async ({ databases }) => {
    const fixture = await pageTransformFixture(databases);

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(NotesRpc, { flatten: true });
          const materials = yield* Pages;
          const notes = yield* Notes;
          const first = yield* client('notes.createNote', { title: 'First' });
          const second = yield* client('notes.createNote', { title: 'Second' });
          const other = yield* client('notes.createNote', { title: 'Unselected' });
          const material = yield* materials.create({
            title: 'Shared',
            inputs: [],
            citations: [],
            createKey: crypto.randomUUID(),
            document: { ...deletionDocument('Shared evidence') }
          });
          const structuredContent = deletionDocument('Retained structure');
          const structured = yield* materials.create({
            title: 'Structured source',
            inputs: [],
            citations: [],
            createKey: crypto.randomUUID(),
            document: { ...structuredContent }
          });

          for (const note of [first, second]) {
            yield* materials.attach({ noteId: note.id, pageId: material.id });
            yield* materials.attach({ noteId: note.id, pageId: structured.id });
            yield* client('notes.postMessage', {
              noteId: note.id,
              text: note.title!
            });
            yield* client('notes.updateNoteSelection', {
              noteId: note.id,
              expectedRevision: 0n,
              targets: [
                {
                  input: { kind: 'page', versionId: material.version!.id },
                  scope: { kind: 'document' }
                },
                {
                  input: { kind: 'page', versionId: structured.version!.id },
                  scope: { kind: 'blocks', blockIds: [structuredContent.blocks[0]!.id] }
                }
              ]
            });
          }

          yield* client('notes.postMessage', {
            noteId: other.id,
            text: 'Do not include'
          });
          const intent = {
            noteId: first.id,
            additionalNoteIds: [second.id],
            intentKey: 'combine',
            instruction: 'Synthesize a cohesive document',
            preferences: {}
          };
          const capture = yield* client('notes.captureNoteContext', intent);

          test.expect(capture.messages.map((item) => item.text)).toStrictEqual(['First', 'Second']);
          test.assert.strictEqual(capture.inputs.length, 2);
          test.assert.ok(capture.inputs[1]!.scope.kind === 'document');
          test
            .expect(capture.inputs[1]!.excerpts[0]!.content)
            .toStrictEqual(structuredContent.blocks[0]!.content);
          test.expect(capture.inputs[0]!.input).toStrictEqual({
            kind: 'page',
            versionId: material.version!.id
          });
          const generation = yield* notes.requestPageTransform({
            contextRequestId: capture.requestId,
            title: 'Combined',
            operations: ['combine', 'structure']
          });

          yield* client('notes.postMessage', { noteId: second.id, text: 'Later' });
          test.expect(yield* client('notes.captureNoteContext', intent)).toStrictEqual(capture);
          const changed = yield* Effect.flip(
            client('notes.captureNoteContext', {
              ...intent,
              additionalNoteIds: [other.id]
            })
          );

          test.assert.ok(changed.kind === 'invalid_input');
          const duplicate = yield* Effect.flip(
            client('notes.captureNoteContext', {
              ...intent,
              intentKey: 'duplicate',
              additionalNoteIds: [first.id]
            })
          );

          test.assert.ok(duplicate.kind === 'invalid_input');
          const large = yield* client('notes.createNote', { title: 'Large context' });

          for (let index = 0; index < 2; index++)
            yield* client('notes.postMessage', {
              noteId: large.id,
              text: 'x'.repeat(100000)
            });

          const oversized = yield* Effect.flip(
            client('notes.captureNoteContext', {
              ...intent,
              intentKey: 'oversized',
              additionalNoteIds: [large.id]
            })
          );

          test.assert.strictEqual(oversized.kind, 'not_enough');
          const sourceOnly = yield* client('notes.createNote', {
            title: 'Sources only'
          });

          yield* client('notes.updateNoteSelection', {
            noteId: sourceOnly.id,
            expectedRevision: 0n,
            targets: [
              {
                input: { kind: 'page', versionId: material.version!.id },
                scope: { kind: 'document' }
              }
            ]
          });
          yield* client('notes.deleteNote', { id: sourceOnly.id });
          const deletedInput = yield* Effect.flip(
            client('notes.captureNoteContext', {
              ...intent,
              intentKey: 'deleted-source-only',
              additionalNoteIds: [sourceOnly.id]
            })
          );

          test.assert.ok(deletedInput.kind === 'not_found');
          yield* client('notes.deleteNote', { id: second.id });
          test.assert.strictEqual(
            fixture.context.db.orm.get(
              sql`SELECT 1 FROM note_run_contexts WHERE request_id=${capture.requestId}`
            ),
            undefined
          );
          test.assert.strictEqual(
            fixture.context.db.orm.get(
              sql`SELECT 1 FROM note_context_pages WHERE request_id=${capture.requestId}`
            ),
            undefined
          );
          test.assert.ok(
            fixture.context.db.orm.get(
              sql`SELECT 1 FROM note_retired_intents WHERE request_id=${capture.requestId}`
            )
          );
          test.assert.ok(
            (yield* materials.transform({ requestId: generation.id })).cancelled === true
          );

          const unavailable = yield* Effect.flip(
            client('notes.noteContext', { requestId: capture.requestId })
          );

          test.assert.ok(unavailable.kind === 'not_found');
          const retry = yield* Effect.flip(
            notes.retryPageTransform({
              requestId: generation.id,
              retryId: 'after-deletion'
            })
          );

          test.assert.ok(retry.kind === 'not_found');
        }).pipe(
          Effect.scoped,
          Effect.provide(
            NotesRpcLive.pipe(Layer.provide(testLiveQueries)).pipe(
              Layer.provideMerge(fixture.domain())
            )
          )
        )
      );
    } finally {
      await fixture.close();
    }
  }
);
