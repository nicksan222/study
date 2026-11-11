/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises note and message RPC missing-value behavior, versioned message           │
 * │ persistence, and isolation of attachment-thread messages.                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Uses the native RPC test client with a real service and isolated database fixtures.    │
 * │ - Checks the contract through typed RPC calls and controlled feature layers.             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite uses the typed RPC test client and controlled feature layers; production       │
 * │ handlers retain ownership of request behavior.                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { NoteId } from '@study/contracts/ids';
import { NotesRpc } from '@study/contracts/notes/rpc';
import { eq } from '@study/db';
import { messages, note_deletions } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Option } from 'effect';
import { RpcTest } from 'effect/rpc';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Notes } from '#server/features/notes/service/index';
import { Settings } from '#server/features/settings/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { NotesRpcLive } from './index.ts';

testStable('native note RPC returns typed missing failures and optional reads', async () => {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
  const handlers = NotesRpcLive.pipe(
    Layer.provideMerge(Layer.merge(Notes.layer, Settings.layer)),
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(NotesRpc, { flatten: true });
          const id = 999n as NoteId;

          assert.ok((yield* Effect.flip(client('notes.note', { id }))).kind === 'not_found');
          assert.ok(Option.isNone(yield* client('notes.findNote', { id })));
        }).pipe(Effect.provide(handlers))
      )
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});

testStable('native message RPC persists and reads a versioned message', async () => {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
  const { projects } = await import('@study/db/schema');
  const project = context.db.orm
    .insert(projects)
    .values({ name: 'RPC', created_at: 1n, updated_at: 1n })
    .returning()
    .get();
  const handlers = NotesRpcLive.pipe(
    Layer.provideMerge(Layer.merge(Notes.layer, Settings.layer)),
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(NotesRpc, { flatten: true });
          const note = yield* client('notes.createNote', {
            project: project.id,
            title: 'RPC'
          });
          const untitled = yield* client('notes.createUntitledNote', {
            project: project.id
          });

          assert.ok(untitled.title === 'New note');
          assert.ok(untitled.titleSource === 'provisional');
          assert.ok(
            (yield* Effect.flip(client('notes.requestTitle', { noteId: untitled.id }))).kind ===
              'invalid_input'
          );
          const rewriteTarget = yield* client('notes.postMessage', {
            noteId: untitled.id,
            text: 'Study ATP'
          });
          const titleRequest = yield* client('notes.requestTitle', {
            noteId: untitled.id
          });

          assert.ok(titleRequest.requestId);
          const rewrite = yield* client('notes.rewriteMessage', {
            messageId: rewriteTarget.id,
            origin: 'improve'
          });

          assert.strictEqual(rewrite.messageId, rewriteTarget.id);
          assert.ok(
            (yield* Effect.flip(client('notes.reanswer', { messageId: rewriteTarget.id }))).kind ===
              'invalid_input'
          );

          assert.ok(
            (yield* Effect.flip(client('notes.requestTitle', { noteId: note.id }))).kind ===
              'invalid_input'
          );
          const message = yield* client('notes.postMessage', {
            noteId: note.id,
            text: 'hello'
          });
          const request = yield* client('notes.requestReply', { noteId: note.id });

          assert.ok(request.requestId);
          assert.ok(
            (yield* Effect.flip(client('notes.requestReply', { noteId: note.id }))).kind ===
              'invalid_input'
          );
          const edited = yield* client('notes.editMessage', {
            messageId: message.id,
            text: 'edited'
          });

          expect(
            (yield* client('notes.message', { id: message.id })).versions.map((v) => v.text)
          ).toStrictEqual(['hello', 'edited']);
          assert.strictEqual(
            (yield* client('notes.thread', { noteId: note.id, limit: 2 })).items[0]
              ?.activeVersionId,
            edited.activeVersionId
          );
          assert.strictEqual(yield* client('notes.deleteMessage', { id: message.id }), true);
          assert.ok(
            (yield* Effect.flip(client('notes.message', { id: message.id }))).kind === 'not_found'
          );
        }).pipe(Effect.provide(handlers))
      )
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});

testStable('native RPC keeps attachment thread messages isolated', async () => {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
  const { projects, sources } = await import('@study/db/schema');
  const project = context.db.orm
    .insert(projects)
    .values({ name: 'RPC threads', created_at: 1n, updated_at: 1n })
    .returning()
    .get();
  const source = context.db.orm
    .insert(sources)
    .values({
      project_id: project.id,
      origin: 'attachment',
      kind: 'text',
      mime: 'text/plain',
      name: 'a.txt',
      size_bytes: 1n,
      sha256: Buffer.alloc(32),
      created_at: 1n
    })
    .returning()
    .get();
  const handlers = NotesRpcLive.pipe(
    Layer.provideMerge(Layer.merge(Notes.layer, Settings.layer)),
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(NotesRpc, { flatten: true });
          const note = yield* client('notes.createNote', {
            project: project.id,
            title: 'Thread'
          });
          const root = yield* client('notes.postMessage', {
            noteId: note.id,
            text: 'root',
            sourceIds: [source.id]
          });
          const part = root.parts[0]!.id;
          const child = yield* client('notes.postMessage', {
            noteId: note.id,
            threadRoot: part,
            text: 'child'
          });

          expect(
            (yield* client('notes.thread', { noteId: note.id, limit: 10 })).items.map((m) => m.id)
          ).toStrictEqual([root.id]);
          expect(
            (yield* client('notes.thread', {
              noteId: note.id,
              threadRoot: part,
              limit: 10
            })).items.map((m) => m.id)
          ).toStrictEqual([child.id]);
        }).pipe(Effect.provide(handlers))
      )
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});

testStable(
  'native description RPC persists optional metadata with optimistic concurrency',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());
    const handlers = NotesRpcLive.pipe(
      Layer.provideMerge(Layer.merge(Notes.layer, Settings.layer)),
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcTest.makeClient(NotesRpc, { flatten: true });
            const note = yield* client('notes.createNote', { title: 'Descriptions' });
            const message = yield* client('notes.postMessage', {
              noteId: note.id,
              text: '# Linear algebra',
              requestReply: false
            });
            const input = {
              messageId: message.id,
              description: '  Eigenvalues and vectors  ',
              expectedDescription: null
            };
            const saved = yield* client('notes.updateMessageDescription', input);

            assert.ok(message.description === null);
            assert.ok(saved.description === 'Eigenvalues and vectors');
            expect(saved.versions).toStrictEqual(message.versions);
            assert.strictEqual(saved.activeVersionId, message.activeVersionId);
            assert.strictEqual(
              (yield* client('notes.message', { id: message.id })).description,
              saved.description
            );
            assert.strictEqual(
              (yield* client('notes.thread', { noteId: note.id, limit: 10 })).items[0]?.description,
              saved.description
            );
            assert.strictEqual(
              (yield* client('notes.updateMessageDescription', input)).description,
              saved.description
            );
            assert.ok(
              (yield* Effect.flip(
                client('notes.updateMessageDescription', {
                  ...input,
                  description: 'Stale overwrite'
                })
              )).kind === 'invalid_input'
            );
            const cleared = yield* client('notes.updateMessageDescription', {
              messageId: message.id,
              description: '  ',
              expectedDescription: saved.description ?? null
            });

            assert.ok(cleared.description === null);
            assert.ok((yield* client('notes.message', { id: message.id })).description === null);
            const notes = yield* Notes;

            assert.ok(
              (yield* Effect.flip(
                notes.updateMessageDescription({
                  messageId: message.id,
                  description: 'x'.repeat(241),
                  expectedDescription: null
                })
              )).kind === 'invalid_input'
            );
            context.db.orm
              .update(messages)
              .set({ role: 'assistant' })
              .where(eq(messages.id, message.id))
              .run();
            assert.ok(
              (yield* Effect.flip(client('notes.updateMessageDescription', input))).kind ===
                'invalid_input'
            );
            context.db.orm
              .update(messages)
              .set({ role: 'user' })
              .where(eq(messages.id, message.id))
              .run();
            context.db.orm
              .insert(note_deletions)
              .values({
                note_id: note.id,
                operation_id: 'description-deletion',
                status: 'pending',
                attempt: 1,
                created_at: 1n
              })
              .run();
            assert.ok(
              (yield* Effect.flip(client('notes.updateMessageDescription', input))).kind ===
                'invalid_input'
            );
          }).pipe(Effect.provide(handlers))
        )
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

testStable(
  'native message RPC preserves explicit document format independently of capture keys',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());
    const handlers = NotesRpcLive.pipe(
      Layer.provideMerge(Layer.merge(Notes.layer, Settings.layer)),
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcTest.makeClient(NotesRpc, { flatten: true });
            const note = yield* client('notes.createNote', { title: 'Formats' });
            const quick = yield* client('notes.postMessage', {
              noteId: note.id,
              text: 'Quick capture',
              requestReply: false,
              captureKey: 'quick-text-capture'
            });
            const documentInput = {
              noteId: note.id,
              text: '# Document',
              requestReply: false,
              captureKey: 'document-capture',
              format: 'document' as const
            };
            const document = yield* client('notes.postMessage', documentInput);

            assert.ok(quick.format === 'text');
            assert.ok(document.format === 'document');
            assert.ok((yield* client('notes.message', { id: document.id })).format === 'document');
            assert.strictEqual((yield* client('notes.postMessage', documentInput)).id, document.id);
            assert.ok(
              (yield* Effect.flip(
                client('notes.postMessage', {
                  ...documentInput,
                  format: 'text'
                })
              )).kind === 'invalid_input'
            );
            const edited = yield* client('notes.editMessage', {
              messageId: document.id,
              text: '# Revised'
            });

            assert.ok(edited.format === 'document');
            expect(
              (yield* client('notes.thread', {
                noteId: note.id,
                limit: 10
              })).items.map((item) => item.format)
            ).toStrictEqual(['text', 'document']);
          }).pipe(Effect.provide(handlers))
        )
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
