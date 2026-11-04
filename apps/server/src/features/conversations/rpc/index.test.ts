/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises session and message RPC missing-value behavior, versioned message        │
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

import assert from 'node:assert/strict';

import { ConversationsRpc } from '@study/contracts/conversations/rpc';
import type { SessionId } from '@study/contracts/ids';
import { eq } from '@study/db';
import { messages, session_deletions } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/node';
import { Effect, Layer, Option } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Conversations } from '#server/features/conversations/service/index';
import { Settings } from '#server/features/settings/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { ConversationsRpcLive } from './index.ts';

testStable('native session RPC returns typed missing failures and optional reads', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const handlers = ConversationsRpcLive.pipe(
    Layer.provideMerge(Layer.merge(Conversations.layer, Settings.layer)),
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });
          const id = 999n as SessionId;

          assert.equal(
            (yield* Effect.flip(client('conversations.session', { id }))).kind,
            'not_found'
          );
          assert.ok(Option.isNone(yield* client('conversations.findSession', { id })));
        }).pipe(Effect.provide(handlers))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

testStable('native message RPC persists and reads a versioned message', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const { projects } = await import('@study/db/schema');
  const project = context.db.orm
    .insert(projects)
    .values({ name: 'RPC', created_at: 1n, updated_at: 1n })
    .returning()
    .get();
  const handlers = ConversationsRpcLive.pipe(
    Layer.provideMerge(Layer.merge(Conversations.layer, Settings.layer)),
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });
          const session = yield* client('conversations.createSession', {
            project: project.id,
            title: 'RPC'
          });
          const untitled = yield* client('conversations.createUntitledSession', {
            project: project.id
          });

          assert.equal(untitled.title, 'New session');
          assert.equal(untitled.titleSource, 'provisional');
          assert.equal(
            (yield* Effect.flip(client('conversations.requestTitle', { sessionId: untitled.id })))
              .kind,
            'invalid_input'
          );
          const rewriteTarget = yield* client('conversations.postMessage', {
            sessionId: untitled.id,
            text: 'Study ATP'
          });
          const titleRequest = yield* client('conversations.requestTitle', {
            sessionId: untitled.id
          });

          assert.ok(titleRequest.requestId);
          const rewrite = yield* client('conversations.rewriteMessage', {
            messageId: rewriteTarget.id,
            origin: 'improve'
          });

          assert.equal(rewrite.messageId, rewriteTarget.id);
          assert.equal(
            (yield* Effect.flip(client('conversations.reanswer', { messageId: rewriteTarget.id })))
              .kind,
            'invalid_input'
          );

          assert.equal(
            (yield* Effect.flip(client('conversations.requestTitle', { sessionId: session.id })))
              .kind,
            'invalid_input'
          );
          const message = yield* client('conversations.postMessage', {
            sessionId: session.id,
            text: 'hello'
          });
          const request = yield* client('conversations.requestReply', { sessionId: session.id });

          assert.ok(request.requestId);
          assert.equal(
            (yield* Effect.flip(client('conversations.requestReply', { sessionId: session.id })))
              .kind,
            'invalid_input'
          );
          const edited = yield* client('conversations.editMessage', {
            messageId: message.id,
            text: 'edited'
          });

          assert.deepEqual(
            (yield* client('conversations.message', { id: message.id })).versions.map(
              (v) => v.text
            ),
            ['hello', 'edited']
          );
          assert.equal(
            (yield* client('conversations.thread', { sessionId: session.id, limit: 2 })).items[0]
              ?.activeVersionId,
            edited.activeVersionId
          );
          assert.equal(yield* client('conversations.deleteMessage', { id: message.id }), true);
          assert.equal(
            (yield* Effect.flip(client('conversations.message', { id: message.id }))).kind,
            'not_found'
          );
        }).pipe(Effect.provide(handlers))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

testStable('native RPC keeps attachment thread messages isolated', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
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
  const handlers = ConversationsRpcLive.pipe(
    Layer.provideMerge(Layer.merge(Conversations.layer, Settings.layer)),
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });
          const session = yield* client('conversations.createSession', {
            project: project.id,
            title: 'Thread'
          });
          const root = yield* client('conversations.postMessage', {
            sessionId: session.id,
            text: 'root',
            sourceIds: [source.id]
          });
          const part = root.parts[0]!.id;
          const child = yield* client('conversations.postMessage', {
            sessionId: session.id,
            threadRoot: part,
            text: 'child'
          });

          assert.deepEqual(
            (yield* client('conversations.thread', { sessionId: session.id, limit: 10 })).items.map(
              (m) => m.id
            ),
            [root.id]
          );
          assert.deepEqual(
            (yield* client('conversations.thread', {
              sessionId: session.id,
              threadRoot: part,
              limit: 10
            })).items.map((m) => m.id),
            [child.id]
          );
        }).pipe(Effect.provide(handlers))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

testStable(
  'native description RPC persists optional metadata with optimistic concurrency',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const handlers = ConversationsRpcLive.pipe(
      Layer.provideMerge(Layer.merge(Conversations.layer, Settings.layer)),
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });
            const session = yield* client('conversations.createSession', { title: 'Descriptions' });
            const message = yield* client('conversations.postMessage', {
              sessionId: session.id,
              text: '# Linear algebra',
              requestReply: false
            });
            const input = {
              messageId: message.id,
              description: '  Eigenvalues and vectors  ',
              expectedDescription: null
            };
            const saved = yield* client('conversations.updateMessageDescription', input);

            assert.equal(message.description, null);
            assert.equal(saved.description, 'Eigenvalues and vectors');
            assert.deepEqual(saved.versions, message.versions);
            assert.equal(saved.activeVersionId, message.activeVersionId);
            assert.equal(
              (yield* client('conversations.message', { id: message.id })).description,
              saved.description
            );
            assert.equal(
              (yield* client('conversations.thread', { sessionId: session.id, limit: 10 })).items[0]
                ?.description,
              saved.description
            );
            assert.equal(
              (yield* client('conversations.updateMessageDescription', input)).description,
              saved.description
            );
            assert.equal(
              (yield* Effect.flip(
                client('conversations.updateMessageDescription', {
                  ...input,
                  description: 'Stale overwrite'
                })
              )).kind,
              'invalid_input'
            );
            const cleared = yield* client('conversations.updateMessageDescription', {
              messageId: message.id,
              description: '  ',
              expectedDescription: saved.description ?? null
            });

            assert.equal(cleared.description, null);
            assert.equal(
              (yield* client('conversations.message', { id: message.id })).description,
              null
            );
            const conversations = yield* Conversations;

            assert.equal(
              (yield* Effect.flip(
                conversations.updateMessageDescription({
                  messageId: message.id,
                  description: 'x'.repeat(241),
                  expectedDescription: null
                })
              )).kind,
              'invalid_input'
            );
            context.db.orm
              .update(messages)
              .set({ role: 'assistant' })
              .where(eq(messages.id, message.id))
              .run();
            assert.equal(
              (yield* Effect.flip(client('conversations.updateMessageDescription', input))).kind,
              'invalid_input'
            );
            context.db.orm
              .update(messages)
              .set({ role: 'user' })
              .where(eq(messages.id, message.id))
              .run();
            context.db.orm
              .insert(session_deletions)
              .values({
                session_id: session.id,
                operation_id: 'description-deletion',
                status: 'pending',
                attempt: 1,
                created_at: 1n
              })
              .run();
            assert.equal(
              (yield* Effect.flip(client('conversations.updateMessageDescription', input))).kind,
              'invalid_input'
            );
          }).pipe(Effect.provide(handlers))
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'native message RPC preserves explicit document format independently of capture keys',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const handlers = ConversationsRpcLive.pipe(
      Layer.provideMerge(Layer.merge(Conversations.layer, Settings.layer)),
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });
            const session = yield* client('conversations.createSession', { title: 'Formats' });
            const quick = yield* client('conversations.postMessage', {
              sessionId: session.id,
              text: 'Quick capture',
              requestReply: false,
              captureKey: 'quick-text-capture'
            });
            const documentInput = {
              sessionId: session.id,
              text: '# Document',
              requestReply: false,
              captureKey: 'document-capture',
              format: 'document' as const
            };
            const document = yield* client('conversations.postMessage', documentInput);

            assert.equal(quick.format, 'text');
            assert.equal(document.format, 'document');
            assert.equal(
              (yield* client('conversations.message', { id: document.id })).format,
              'document'
            );
            assert.equal(
              (yield* client('conversations.postMessage', documentInput)).id,
              document.id
            );
            assert.equal(
              (yield* Effect.flip(
                client('conversations.postMessage', {
                  ...documentInput,
                  format: 'text'
                })
              )).kind,
              'invalid_input'
            );
            const edited = yield* client('conversations.editMessage', {
              messageId: document.id,
              text: '# Revised'
            });

            assert.equal(edited.format, 'document');
            assert.deepEqual(
              (yield* client('conversations.thread', {
                sessionId: session.id,
                limit: 10
              })).items.map((item) => item.format),
              ['text', 'document']
            );
          }).pipe(Effect.provide(handlers))
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
