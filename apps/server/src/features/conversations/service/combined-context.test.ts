/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises conversation combined context behavior through real persistence          │
 * │ boundaries.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies combined capture pins selected sessions and shared sources, replays exactly   │
 * │   and retires on source-session deletion.                                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import { ConversationsRpc } from '@study/contracts/conversations/rpc';
import { sql } from '@study/db';
import { testStable } from '@study/testing/node';
import { Effect } from 'effect';
import { Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Conversations } from '#server/features/conversations/index';
import { ConversationsRpcLive } from '#server/features/conversations/rpc/index';
import { Documents } from '#server/features/documents/index';
import { documentTransformFixture } from '#testing/document-transform';
import { deletionDocument } from '#testing/material-deletion';

testStable(
  'combined capture pins selected sessions and shared sources, replays exactly and retires on source-session deletion',
  async () => {
    const fixture = await documentTransformFixture();

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });
          const materials = yield* Documents;
          const conversations = yield* Conversations;
          const first = yield* client('conversations.createSession', { title: 'First' });
          const second = yield* client('conversations.createSession', { title: 'Second' });
          const other = yield* client('conversations.createSession', { title: 'Unselected' });
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

          for (const session of [first, second]) {
            yield* client('conversations.postMessage', {
              sessionId: session.id,
              text: session.title!
            });
            yield* client('conversations.updateSessionSelection', {
              sessionId: session.id,
              expectedRevision: 0n,
              targets: [
                {
                  input: { kind: 'document', versionId: material.version!.id },
                  scope: { kind: 'document' }
                },
                {
                  input: { kind: 'document', versionId: structured.version!.id },
                  scope: { kind: 'blocks', blockIds: [structuredContent.blocks[0]!.id] }
                }
              ]
            });
          }

          yield* client('conversations.postMessage', {
            sessionId: other.id,
            text: 'Do not include'
          });
          const intent = {
            sessionId: first.id,
            additionalSessionIds: [second.id],
            intentKey: 'combine',
            instruction: 'Synthesize a cohesive document',
            preferences: {}
          };
          const capture = yield* client('conversations.captureSessionContext', intent);

          assert.deepEqual(
            capture.messages.map((item) => item.text),
            ['First', 'Second']
          );
          assert.equal(capture.inputs.length, 2);
          assert.equal(capture.inputs[1]!.scope.kind, 'blocks');
          assert.deepEqual(
            capture.inputs[1]!.excerpts[0]!.content,
            structuredContent.blocks[0]!.content
          );
          assert.deepEqual(capture.inputs[0]!.input, {
            kind: 'document',
            versionId: material.version!.id
          });
          const generation = yield* conversations.requestDocumentTransform({
            contextRequestId: capture.requestId,
            title: 'Combined',
            operations: ['combine', 'structure']
          });

          yield* client('conversations.postMessage', { sessionId: second.id, text: 'Later' });
          assert.deepEqual(yield* client('conversations.captureSessionContext', intent), capture);
          const changed = yield* Effect.flip(
            client('conversations.captureSessionContext', {
              ...intent,
              additionalSessionIds: [other.id]
            })
          );

          assert.equal(changed.kind, 'invalid_input');
          const duplicate = yield* Effect.flip(
            client('conversations.captureSessionContext', {
              ...intent,
              intentKey: 'duplicate',
              additionalSessionIds: [first.id]
            })
          );

          assert.equal(duplicate.kind, 'invalid_input');
          const large = yield* client('conversations.createSession', { title: 'Large context' });

          for (let index = 0; index < 2; index++)
            yield* client('conversations.postMessage', {
              sessionId: large.id,
              text: 'x'.repeat(100000)
            });

          const oversized = yield* Effect.flip(
            client('conversations.captureSessionContext', {
              ...intent,
              intentKey: 'oversized',
              additionalSessionIds: [large.id]
            })
          );

          assert.equal(oversized.kind, 'invalid_input');
          const sourceOnly = yield* client('conversations.createSession', {
            title: 'Sources only'
          });

          yield* client('conversations.updateSessionSelection', {
            sessionId: sourceOnly.id,
            expectedRevision: 0n,
            targets: [
              {
                input: { kind: 'document', versionId: material.version!.id },
                scope: { kind: 'document' }
              }
            ]
          });
          yield* client('conversations.deleteSession', { id: sourceOnly.id });
          const deletedInput = yield* Effect.flip(
            client('conversations.captureSessionContext', {
              ...intent,
              intentKey: 'deleted-source-only',
              additionalSessionIds: [sourceOnly.id]
            })
          );

          assert.equal(deletedInput.kind, 'not_found');
          yield* client('conversations.deleteSession', { id: second.id });
          assert.equal(
            fixture.context.db.orm.get(
              sql`SELECT 1 FROM session_run_contexts WHERE request_id=${capture.requestId}`
            ),
            undefined
          );
          assert.equal(
            fixture.context.db.orm.get(
              sql`SELECT 1 FROM session_context_documents WHERE request_id=${capture.requestId}`
            ),
            undefined
          );
          assert.ok(
            fixture.context.db.orm.get(
              sql`SELECT 1 FROM session_retired_intents WHERE request_id=${capture.requestId}`
            )
          );
          assert.equal((yield* materials.transform({ requestId: generation.id })).cancelled, true);

          const unavailable = yield* Effect.flip(
            client('conversations.sessionContext', { requestId: capture.requestId })
          );

          assert.equal(unavailable.kind, 'not_found');
          const retry = yield* Effect.flip(
            conversations.retryDocumentTransform({
              requestId: generation.id,
              retryId: 'after-deletion'
            })
          );

          assert.equal(retry.kind, 'not_found');
        }).pipe(
          Effect.scoped,
          Effect.provide(ConversationsRpcLive.pipe(Layer.provideMerge(fixture.domain())))
        )
      );
    } finally {
      await fixture.close();
    }
  }
);
