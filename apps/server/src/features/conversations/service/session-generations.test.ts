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

import assert from 'node:assert/strict';

import { ConversationsRpc } from '@study/contracts/conversations/rpc';
import { testStable } from '@study/testing/node';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Conversations } from '#server/features/conversations/index';
import { ConversationsRpcLive } from '#server/features/conversations/rpc/index';
import { Materials } from '#server/features/materials/index';
import { documentTransformFixture } from '#testing/document-transform';
import {
  acceptMaterialDeletion,
  cleanupMaterial,
  deletionDocument
} from '#testing/material-deletion';

testStable(
  'session generation RPC discovers bounded exact requests across reopen and input retirement',
  async () => {
    const fixture = await documentTransformFixture();

    try {
      const setup = await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Conversations;
          const materials = yield* Materials;
          const session = yield* chats.createSession({ title: 'Discover' });
          const other = yield* chats.createSession({ title: 'Other' });
          const input = yield* materials.create({
            title: 'Input',
            publish: true,
            content: { kind: 'document', ...deletionDocument('Retained discovery evidence') }
          });

          yield* chats.updateSessionSelection({
            sessionId: session.id,
            expectedRevision: 0n,
            targets: [{ versionId: input.version.id, scope: { kind: 'document' } }]
          });
          const note = yield* chats.postMessage({
            sessionId: session.id,
            text: 'Captured context'
          });
          const requests = [];

          for (const intentKey of ['first', 'second', 'third']) {
            const capture = yield* chats.captureSessionContext({
              sessionId: session.id,
              intentKey,
              instruction: 'Private discovery instruction',
              preferences: {}
            });
            const request = yield* chats.requestDocumentTransform({
              contextRequestId: capture.requestId,
              title: 'Transform',
              operations: ['clarity']
            });

            requests.push({ requestId: request.id, contextRequestId: capture.requestId });
          }

          return {
            session,
            note,
            other,
            input,
            requests: requests.sort((a, b) => (a.requestId < b.requestId ? 1 : -1))
          };
        }).pipe(Effect.provide(fixture.domain()))
      );

      fixture.reopen();
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });
            const first = yield* rpc('conversations.sessionGenerations', {
              sessionId: setup.session.id,
              limit: 1
            });

            assert.equal(first.items[0]?.requestId, setup.requests[0]!.requestId);
            assert.equal(first.items[0]?.contextRequestId, setup.requests[0]!.contextRequestId);
            assert.equal(first.items[0]?.state, 'available');
            assert.equal(first.next, setup.requests[0]!.requestId);
            const rest = yield* rpc('conversations.sessionGenerations', {
              sessionId: setup.session.id,
              limit: 2,
              before: first.next!
            });

            assert.deepEqual(
              rest.items.map((i) => i.requestId),
              setup.requests.slice(1).map((i) => i.requestId)
            );
            assert.equal(rest.next, null);
            assert.deepEqual(
              (yield* rpc('conversations.sessionGenerations', {
                sessionId: setup.other.id,
                limit: 100
              })).items,
              []
            );
          }).pipe(Effect.provide(ConversationsRpcLive.pipe(Layer.provideMerge(fixture.domain()))))
        )
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Conversations;

          yield* chats.editMessage({ messageId: setup.note.id, text: 'Changed after capture' });
          const page = yield* chats.sessionGenerations({ sessionId: setup.session.id, limit: 100 });

          assert.ok(page.items.every((item) => item.state === 'available'));
          assert.deepEqual(
            page.items.map((item) => item.requestId),
            setup.requests.map((item) => item.requestId)
          );
        }).pipe(Effect.provide(fixture.domain()))
      );
      await acceptMaterialDeletion(fixture, setup.input.id);
      await cleanupMaterial(fixture, setup.input.id);
      fixture.reopen();
      await Effect.runPromise(
        Effect.gen(function* () {
          const page = yield* (yield* Conversations).sessionGenerations({
            sessionId: setup.session.id,
            limit: 100
          });

          assert.deepEqual(
            page.items.map((i) => i.requestId),
            setup.requests.map((i) => i.requestId)
          );
          assert.ok(
            page.items.every(
              (i) =>
                i.state === 'retired' && i.resultVersionId === null && i.proposedVersionId === null
            )
          );
        }).pipe(Effect.provide(fixture.domain()))
      );
    } finally {
      await fixture.close();
    }
  }
);
