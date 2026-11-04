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

import { ConversationsRpc } from '@study/contracts/conversations/rpc';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/index';
import { ConversationsRpcLive } from '#server/features/conversations/rpc/index';
import { Documents } from '#server/features/documents/index';
import { documentTransformFixture } from '#testing/document-transform';
import { deletionDocument } from '#testing/material-deletion';
import { cleanup } from '#testing/session-deletion';

testStable(
  'session generation RPC discovers bounded exact requests across reopen, cancellation and session retirement',
  async () => {
    const fixture = await documentTransformFixture();

    try {
      const setup = await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Conversations;
          const documents = yield* Documents;
          const session = yield* chats.createSession({ title: 'Discover' });
          const other = yield* chats.createSession({ title: 'Other' });
          const input = yield* documents.create({
            createKey: 'discovery-input',
            inputs: [],
            citations: [],
            title: 'Input',
            sessionId: session.id,
            document: deletionDocument('Retained discovery evidence')
          });

          assert.ok(input.version);
          yield* chats.updateSessionSelection({
            sessionId: session.id,
            expectedRevision: 0n,
            targets: [
              {
                input: { kind: 'document', versionId: input.version.id },
                scope: { kind: 'document' }
              }
            ]
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

            assert.strictEqual(first.items[0]?.requestId, setup.requests[0]!.requestId);
            assert.strictEqual(
              first.items[0]?.contextRequestId,
              setup.requests[0]!.contextRequestId
            );
            assert.ok(first.items[0]?.state === 'available');
            assert.strictEqual(first.next, setup.requests[0]!.requestId);
            const rest = yield* rpc('conversations.sessionGenerations', {
              sessionId: setup.session.id,
              limit: 2,
              before: first.next!
            });

            expect(rest.items.map((i) => i.requestId)).toStrictEqual(
              setup.requests.slice(1).map((i) => i.requestId)
            );
            assert.ok(rest.next === null);
            expect(
              (yield* rpc('conversations.sessionGenerations', {
                sessionId: setup.other.id,
                limit: 100
              })).items
            ).toStrictEqual([]);
          }).pipe(Effect.provide(ConversationsRpcLive.pipe(Layer.provideMerge(fixture.domain()))))
        )
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Conversations;

          yield* chats.editMessage({ messageId: setup.note.id, text: 'Changed after capture' });
          const page = yield* chats.sessionGenerations({ sessionId: setup.session.id, limit: 100 });

          assert.ok(page.items.every((item) => item.state === 'available'));
          expect(page.items.map((item) => item.requestId)).toStrictEqual(
            setup.requests.map((item) => item.requestId)
          );
        }).pipe(Effect.provide(fixture.domain()))
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Documents;
          const chats = yield* Conversations;

          assert.ok((yield* docs.previewDeletion({ id: setup.input.id })).blockedVersionIds.length);
          yield* docs.cancelTransform({ requestId: setup.requests[0]!.requestId });
          const page = yield* chats.sessionGenerations({ sessionId: setup.session.id, limit: 100 });

          assert.ok(page.items[0]?.cancelled === true);
          assert.ok(page.items.every((item) => item.state === 'available'));
          yield* chats.deleteSession(setup.session.id);
        }).pipe(Effect.provide(fixture.domain()))
      );
      await cleanup(fixture, setup.session.id);
      fixture.reopen();
      await Effect.runPromise(
        Effect.gen(function* () {
          const chats = yield* Conversations;

          assert.ok(
            (yield* Effect.flip(
              chats.sessionGenerations({ sessionId: setup.session.id, limit: 100 })
            )).kind === 'not_found'
          );
          const docs = yield* Documents;
          const retained = yield* docs.document({ id: setup.input.id });

          assert.ok(retained.version);
          assert.ok(retained.version.document.blocks[0]?.text === 'Retained discovery evidence');
        }).pipe(Effect.provide(fixture.domain()))
      );
    } finally {
      await fixture.close();
    }
  }
);
