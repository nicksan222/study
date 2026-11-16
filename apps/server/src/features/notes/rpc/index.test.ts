import type { NoteId } from '@study/contracts';
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
import { NotesRpc } from '@study/contracts';
import { eq } from '@study/db';
import { messages, note_deletions } from '@study/db';
import { test } from '@study/testing';
import { Effect, Layer, Option } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Notes } from '#server/features/notes/service/index';
import { Settings } from '#server/features/settings/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { testLiveQueries } from '#testing/live-queries';

import { NotesRpcLive } from './index.ts';

test.stable(
  'native note RPC returns typed missing failures and optional reads',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const handlers = NotesRpcLive.pipe(Layer.provide(testLiveQueries)).pipe(
      Layer.provideMerge(Layer.merge(Notes.layer, Settings.layer)),
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcTest.makeClient(NotesRpc, { flatten: true });
            const id = 999n as NoteId;

            test.assert.ok((yield* Effect.flip(client('notes.note', { id }))).kind === 'not_found');
            test.assert.ok(Option.isNone(yield* client('notes.findNote', { id })));
          }).pipe(Effect.provide(handlers))
        )
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable('native message RPC persists and reads a versioned message', async ({ databases }) => {
  const location = await databases();
  const context = new ServerContext(await location.open());
  const { projects } = await import('@study/db');
  const project = context.db.orm
    .insert(projects)
    .values({ name: 'RPC', created_at: 1n, updated_at: 1n })
    .returning()
    .get();
  const handlers = NotesRpcLive.pipe(Layer.provide(testLiveQueries)).pipe(
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

          test.assert.ok(untitled.title === 'New note');
          test.assert.ok(untitled.titleSource === 'provisional');
          test.assert.ok(
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

          test.assert.ok(titleRequest.requestId);
          const rewrite = yield* client('notes.rewriteMessage', {
            messageId: rewriteTarget.id,
            origin: 'improve'
          });

          test.assert.strictEqual(rewrite.messageId, rewriteTarget.id);
          test.assert.ok(
            (yield* Effect.flip(client('notes.reanswer', { messageId: rewriteTarget.id }))).kind ===
              'invalid_input'
          );

          test.assert.ok(
            (yield* Effect.flip(client('notes.requestTitle', { noteId: note.id }))).kind ===
              'invalid_input'
          );
          const message = yield* client('notes.postMessage', {
            noteId: note.id,
            text: 'hello'
          });
          const request = yield* client('notes.requestReply', { noteId: note.id });

          test.assert.ok(request.requestId);
          test.assert.ok(
            (yield* Effect.flip(client('notes.requestReply', { noteId: note.id }))).kind ===
              'invalid_input'
          );
          const edited = yield* client('notes.editMessage', {
            messageId: message.id,
            text: 'edited'
          });

          test
            .expect(
              (yield* client('notes.message', { id: message.id })).versions.map((v) => v.text)
            )
            .toStrictEqual(['hello', 'edited']);
          test.assert.strictEqual(
            (yield* client('notes.thread', { noteId: note.id, limit: 2 })).items[0]
              ?.activeVersionId,
            edited.activeVersionId
          );
          test.assert.strictEqual(yield* client('notes.deleteMessage', { id: message.id }), true);
          test.assert.ok(
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

test.stable('native RPC keeps attachment thread messages isolated', async ({ databases }) => {
  const location = await databases();
  const context = new ServerContext(await location.open());
  const { projects, sources } = await import('@study/db');
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
  const handlers = NotesRpcLive.pipe(Layer.provide(testLiveQueries)).pipe(
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

          test
            .expect(
              (yield* client('notes.thread', { noteId: note.id, limit: 10 })).items.map((m) => m.id)
            )
            .toStrictEqual([root.id]);
          test
            .expect(
              (yield* client('notes.thread', {
                noteId: note.id,
                threadRoot: part,
                limit: 10
              })).items.map((m) => m.id)
            )
            .toStrictEqual([child.id]);
        }).pipe(Effect.provide(handlers))
      )
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});

test.stable(
  'native description RPC persists optional metadata with optimistic concurrency',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const handlers = NotesRpcLive.pipe(Layer.provide(testLiveQueries)).pipe(
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

            test.assert.ok(message.description === null);
            test.assert.ok(saved.description === 'Eigenvalues and vectors');
            test.expect(saved.versions).toStrictEqual(message.versions);
            test.assert.strictEqual(saved.activeVersionId, message.activeVersionId);
            test.assert.strictEqual(
              (yield* client('notes.message', { id: message.id })).description,
              saved.description
            );
            test.assert.strictEqual(
              (yield* client('notes.thread', { noteId: note.id, limit: 10 })).items[0]?.description,
              saved.description
            );
            test.assert.strictEqual(
              (yield* client('notes.updateMessageDescription', input)).description,
              saved.description
            );
            test.assert.ok(
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

            test.assert.ok(cleared.description === null);
            test.assert.ok(
              (yield* client('notes.message', { id: message.id })).description === null
            );
            const notes = yield* Notes;

            test.assert.ok(
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
            test.assert.ok(
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
            test.assert.ok(
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

test.stable(
  'native message RPC preserves explicit document format independently of capture keys',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const handlers = NotesRpcLive.pipe(Layer.provide(testLiveQueries)).pipe(
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

            test.assert.ok(quick.format === 'text');
            test.assert.ok(document.format === 'document');
            test.assert.ok(
              (yield* client('notes.message', { id: document.id })).format === 'document'
            );
            test.assert.strictEqual(
              (yield* client('notes.postMessage', documentInput)).id,
              document.id
            );
            test.assert.ok(
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

            test.assert.ok(edited.format === 'document');
            test
              .expect(
                (yield* client('notes.thread', {
                  noteId: note.id,
                  limit: 10
                })).items.map((item) => item.format)
              )
              .toStrictEqual(['text', 'document']);
          }).pipe(Effect.provide(handlers))
        )
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
