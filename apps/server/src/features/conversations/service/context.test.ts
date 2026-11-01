import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConversationsRpc } from '@study/contracts/conversations/rpc';
import type { DocumentId } from '@study/contracts/ids';
import { createBlock } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Conversations } from '#server/features/conversations/index';
import { ConversationsRpcLive } from '#server/features/conversations/rpc/index';
import { Materials } from '#server/features/materials/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

const content = (value: string) => ({
  kind: 'document' as const,
  blocks: [createBlock({ type: 'paragraph', inlines: [{ type: 'text', text: value, marks: [] }] })],
  meta: {
    extractor: null,
    extractorVersion: 1,
    provider: null,
    durationMs: null,
    pageCount: null,
    refiners: [],
    waitingFor: [],
    corrected: false,
    omissions: []
  }
});

test('native selection guards exact historic ranges, captures once and survives edits and reopen', async () => {
  const location = createTestDatabase();
  let context = new ServerContext(location.open());
  const services = () =>
    Layer.merge(Conversations.layer, Materials.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );
  const handlers = () => ConversationsRpcLive.pipe(Layer.provideMerge(services()));
  try {
    const captured = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });
          const materials = yield* Materials;
          const first = yield* client('conversations.createSession', { title: 'Quick' });
          const second = yield* client('conversations.createSession', { title: 'Other' });
          const body = content('before 😀 selected after');
          const material = yield* materials.create({
            title: 'Shared',
            content: body,
            publish: true
          });
          const documentId = context.db.orm
            .select()
            .from(s.material_document_versions)
            .where(eq(s.material_document_versions.version_id, material.version.id))
            .get()!.document_id;
          const range = {
            versionId: material.version.id,
            documentId,
            blockId: body.blocks[0]!.id,
            start: 10,
            end: 18
          };
          const target = {
            versionId: material.version.id,
            documentId,
            scope: { kind: 'ranges' as const, ranges: [range] }
          };
          yield* client('conversations.updateSessionSelection', {
            sessionId: first.id,
            expectedRevision: 0n,
            targets: [target]
          });
          assert.equal(
            (yield* Effect.flip(
              client('conversations.updateSessionSelection', {
                sessionId: first.id,
                expectedRevision: 0n,
                targets: []
              })
            )).kind,
            'invalid_input'
          );
          assert.deepEqual(
            (yield* client('conversations.sessionSelection', { sessionId: second.id })).targets,
            []
          );
          const bad = {
            ...target,
            scope: { kind: 'ranges' as const, ranges: [{ ...range, start: 8 }] }
          };
          assert.equal(
            (yield* Effect.flip(
              client('conversations.updateSessionSelection', {
                sessionId: second.id,
                expectedRevision: 0n,
                targets: [bad]
              })
            )).kind,
            'invalid_input'
          );
          assert.equal(
            (yield* Effect.flip(
              client('conversations.updateSessionSelection', {
                sessionId: second.id,
                expectedRevision: 0n,
                targets: [{ ...target, documentId: 999n as DocumentId }]
              })
            )).kind,
            'invalid_input'
          );
          const intent = {
            sessionId: first.id,
            intentKey: 'selection-only',
            instruction: 'Explain',
            preferences: { detail: 'brief' as const }
          };
          const snapshot = yield* client('conversations.captureSessionContext', intent);
          assert.equal(snapshot.inputs[0]!.excerpts[0]!.text, 'selected');
          assert.deepEqual(snapshot.messages, []);
          yield* materials.createVersion({
            materialId: material.id,
            content: content('new content'),
            publish: true
          });
          yield* client('conversations.updateSessionSelection', {
            sessionId: first.id,
            expectedRevision: 1n,
            targets: []
          });
          assert.deepEqual(yield* client('conversations.captureSessionContext', intent), snapshot);
          assert.equal(
            (yield* Effect.flip(
              client('conversations.captureSessionContext', { ...intent, instruction: 'Changed' })
            )).kind,
            'invalid_input'
          );
          yield* client('conversations.updateSessionSelection', {
            sessionId: first.id,
            expectedRevision: 2n,
            targets: [target]
          });
          const message = yield* client('conversations.postMessage', {
            sessionId: first.id,
            text: 'Question'
          });
          const request = yield* client('conversations.requestReply', {
            sessionId: first.id,
            intentKey: 'reply',
            instruction: 'Use selected passage'
          });
          const before = yield* client('conversations.replySnapshot', {
            requestId: request.requestId
          });
          yield* client('conversations.editMessage', {
            messageId: message.id,
            text: 'Changed later'
          });
          yield* client('conversations.updateSessionSelection', {
            sessionId: first.id,
            expectedRevision: 3n,
            targets: []
          });
          assert.deepEqual(
            yield* client('conversations.replySnapshot', { requestId: request.requestId }),
            before
          );
          assert.deepEqual(
            yield* client('conversations.requestReply', {
              sessionId: first.id,
              intentKey: 'reply',
              instruction: 'Use selected passage'
            }),
            request
          );
          const conversations = yield* Conversations;
          assert.equal(
            (yield* Effect.flip(
              conversations.publishReply({
                requestId: request.requestId,
                text: 'Outside [1]',
                citations: [
                  {
                    marker: 1,
                    sourceId: null,
                    materialVersionId: material.version.id,
                    documentId,
                    blockOrdinal: 0,
                    quote: 'before'
                  }
                ]
              })
            )).kind,
            'invalid_input'
          );
          yield* conversations.publishReply({
            requestId: request.requestId,
            text: 'Inside [1]',
            citations: [
              {
                marker: 1,
                sourceId: null,
                materialVersionId: material.version.id,
                documentId,
                blockOrdinal: 0,
                quote: 'selected'
              }
            ]
          });
          const answer = yield* client('conversations.message', { id: request.messageId });
          assert.equal(answer.citations[0]!.materialVersionId, material.version.id);
          assert.equal(answer.citations[0]!.rangeStart, 10);
          return snapshot;
        }).pipe(Effect.provide(handlers()))
      )
    );
    context.close();
    context = new ServerContext(location.open());
    const reopened = await Effect.runPromise(
      Effect.flatMap(Conversations, (c) =>
        c.sessionContext({ requestId: captured.requestId })
      ).pipe(Effect.provide(services()))
    );
    assert.deepEqual(reopened, captured);
  } finally {
    context.close();
    location.cleanup();
  }
});

test('reply outbox rejection rolls back the logical context and retry uses original message versions', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Conversations.layer.pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        const session = yield* conversations.createSession({ title: 'Rollback' });
        yield* conversations.postMessage({ sessionId: session.id, text: 'Original' });
        context.db.orm.run(
          sql`CREATE TRIGGER reject_context_event BEFORE INSERT ON workflow_events BEGIN SELECT RAISE(ABORT, 'rejected'); END`
        );
        yield* Effect.flip(
          conversations.requestReply({ sessionId: session.id, intentKey: 'retry' })
        );
        assert.equal(context.db.orm.select().from(s.session_run_contexts).all().length, 0);
        assert.equal(context.db.orm.select().from(s.conversation_reply_requests).all().length, 0);
        context.db.orm.run(sql`DROP TRIGGER reject_context_event`);
        const request = yield* conversations.requestReply({
          sessionId: session.id,
          intentKey: 'retry'
        });
        assert.equal((yield* conversations.sessionContext(request)).messages[0]!.text, 'Original');
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('selection order is independent of membership and bounded history reports omitted messages', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Layer.merge(Conversations.layer, Materials.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        const materials = yield* Materials;
        const first = yield* conversations.createSession({ title: 'One' });
        const second = yield* conversations.createSession({ title: 'Two' });
        assert.equal(
          (yield* Effect.flip(
            conversations.captureSessionContext({
              sessionId: first.id,
              intentKey: 'empty',
              instruction: '',
              preferences: {}
            })
          )).kind,
          'invalid_input'
        );
        const a = yield* materials.create({
          title: 'A',
          sessionId: first.id,
          content: content('Alpha'),
          publish: true
        });
        const b = yield* materials.create({ title: 'B', content: content('Beta'), publish: true });
        assert.deepEqual(
          (yield* conversations.sessionSelection({ sessionId: first.id })).targets,
          []
        );
        yield* materials.detach({ sessionId: first.id, materialId: a.id });
        const targets = [a, b].map((item) => ({
          versionId: item.version.id,
          scope: { kind: 'document' as const }
        }));
        yield* conversations.updateSessionSelection({
          sessionId: first.id,
          expectedRevision: 0n,
          targets
        });
        yield* conversations.updateSessionSelection({
          sessionId: second.id,
          expectedRevision: 0n,
          targets: [targets[0]!]
        });
        yield* conversations.updateSessionSelection({
          sessionId: first.id,
          expectedRevision: 1n,
          targets: targets.toReversed()
        });
        const ordered = yield* conversations.captureSessionContext({
          sessionId: first.id,
          intentKey: 'ordered',
          instruction: '',
          preferences: {}
        });
        assert.deepEqual(
          ordered.inputs.map((item) => item.versionId),
          [b.version.id, a.version.id]
        );
        assert.equal(
          (yield* conversations.sessionSelection({ sessionId: second.id })).targets.length,
          1
        );
        const draft = yield* materials.create({
          title: 'Draft',
          content: content('Unpublished'),
          publish: false
        });
        assert.equal(
          (yield* Effect.flip(
            conversations.updateSessionSelection({
              sessionId: second.id,
              expectedRevision: 1n,
              targets: [{ versionId: draft.version.id, scope: { kind: 'document' } }]
            })
          )).kind,
          'not_found'
        );
        assert.equal(
          (yield* Effect.flip(
            conversations.updateSessionSelection({
              sessionId: second.id,
              expectedRevision: 1n,
              targets: [targets[0]!, targets[0]!]
            })
          )).kind,
          'invalid_input'
        );
        for (let i = 0; i < 55; i++)
          yield* conversations.postMessage({ sessionId: first.id, text: 'Message ' + i });
        const history = yield* conversations.captureSessionContext({
          sessionId: first.id,
          intentKey: 'bounded',
          instruction: '',
          preferences: {}
        });
        assert.throws(() =>
          context.db.orm
            .update(s.session_run_contexts)
            .set({ snapshot: '{}' })
            .where(eq(s.session_run_contexts.request_id, history.requestId))
            .run()
        );
        assert.equal(history.messages.length, 50);
        assert.equal(history.excludedMessages, 5);
        assert.equal(history.messages[0]!.text, 'Message 5');
        yield* conversations.deleteMessage(history.messages[0]!.messageId);
        assert.deepEqual(
          yield* conversations.inspectSessionContext({ requestId: history.requestId }),
          history
        );
        assert.equal(
          (yield* Effect.flip(conversations.sessionContext({ requestId: history.requestId }))).kind,
          'not_found'
        );
        assert.equal(
          (yield* Effect.flip(
            conversations.captureSessionContext({
              sessionId: first.id,
              intentKey: 'bounded',
              instruction: '',
              preferences: {}
            })
          )).kind,
          'not_found'
        );
        assert.equal(
          (yield* conversations.sessionContext({ requestId: ordered.requestId })).inputs[0]!
            .excerpts[0]!.text,
          'Beta'
        );
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
