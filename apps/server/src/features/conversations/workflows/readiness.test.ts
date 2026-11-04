/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Covers reply wake-up from indexed-source receipts and confirms pending replies     │
 * │ survive database reopen and are invalidated when their context is deleted.               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reopens the database to verify persisted readiness receipts wake pending replies.      │
 * │ - Asserts durable effects against persisted state and replay behavior.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite drives the native workflow engine with persisted test state; it does not       │
 * │ replace production activities.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createServer } from 'node:http';

import { eq } from '@study/db';
import * as tables from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Option } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/service/index';
import { Sources } from '#server/features/sources/service/index';
import {
  sourceIngestionHandler,
  sourceIngestionWorkflow
} from '#server/features/sources/workflows/index';
import { layer as agentsLayer } from '#server/platform/ai/agents';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { cancelExecution, WorkflowControl } from '#server/platform/workflows/control';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { decodeEvent } from '#server/platform/workflows/events';
import { workflowStore } from '#server/platform/workflows/store';
import { dispatchPending } from '#server/platform/workflows/triggers';
import { createUnregisteredSource } from '#testing/source';

import { sessionDeletionWorkflow, sessionDeletionHandler } from './deletion.ts';
import {
  conversationReplyHandler,
  conversationReplyWorkflow,
  conversationReplyRegistration,
  conversationAttachmentWakeHandler,
  conversationAttachmentWakeWorkflow,
  conversationAttachmentWakeRegistration
} from './index.ts';

testStable('indexed source wakes the dispatched reply using its persisted receipt', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  let calls = 0;
  const peer = createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* drain request */
    }

    calls++;
    response.writeHead(200, { 'content-type': 'text/event-stream' });

    for (const event of [
      { type: 'response.created', response: { id: 'resp', created_at: 1, model: 'test' } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: 'item' }
      },
      { type: 'response.output_text.delta', item_id: 'item', delta: 'Answer' },
      { type: 'response.completed', response: {} }
    ])
      response.write(`data: ${JSON.stringify(event)}\n\n`);

    response.end('data: [DONE]\n\n');
  });

  await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve));
  const address = peer.address();

  assert.ok(!(!address || typeof address === 'string'), 'missing address');

  const base = `http://127.0.0.1:${address.port}`;
  const auth = new AuthManager({ issuer: base, saveRefresh: async () => {} });

  await auth.replace(
    { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
    { accessToken: 'token', expiresIn: 3600 }
  );
  const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
  const database = Layer.succeed(Database, { store: context });
  const services = Layer.mergeAll(
    database,
    Layer.merge(Conversations.layer, Sources.layer).pipe(Layer.provideMerge(database)),
    Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
    agentsLayer({
      model: () => Effect.succeed(model),
      language: 'en',
      searchSources: () => Effect.succeed([])
    }),
    workflowEngineLayer(context)
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const conversations = yield* Conversations;
          const sources = yield* Sources;
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(conversationReplyWorkflow, conversationReplyHandler);
          yield* engine.register(
            conversationAttachmentWakeWorkflow,
            conversationAttachmentWakeHandler
          );
          yield* engine.register(sourceIngestionWorkflow, sourceIngestionHandler);
          const project = context.db.orm
            .insert(tables.projects)
            .values({ name: 'P', created_at: 1n, updated_at: 1n })
            .returning()
            .get();
          const session = yield* conversations.createSession({
            project: project.id,
            title: 'Chat'
          });
          const source = yield* createUnregisteredSource({
            projectId: project.id,
            name: 'note.txt',
            bytes: new TextEncoder().encode('Hello')
          });

          yield* conversations.postMessage({
            sessionId: session.id,
            text: 'Question',
            sourceIds: [source.id]
          });
          const request = yield* conversations.requestReply({ sessionId: session.id });

          assert.strictEqual(
            (yield* conversations.replyReadiness({ requestId: request.requestId })).length,
            1
          );
          assert.strictEqual(
            dispatchPending(context, conversationReplyRegistration.triggers, Date.now()),
            1
          );
          const receipt = context.db.orm
            .select()
            .from(tables.workflowReceipts)
            .where(eq(tables.workflowReceipts.subscription, 'conversation-reply'))
            .get()!;
          const generation = decodeEvent(
            context.db.orm
              .select()
              .from(tables.workflowEvents)
              .where(eq(tables.workflowEvents.eventId, receipt.eventId))
              .get()!.payload
          );

          assertEventType(generation, 'ConversationGenerationRequested', 'wrong event');

          yield* engine.execute(conversationReplyWorkflow, {
            executionId: receipt.executionId,
            payload: { event: generation },
            discard: true
          });
          let result = yield* engine.poll(conversationReplyWorkflow, receipt.executionId);

          while (Option.isNone(result)) {
            yield* Effect.sleep('10 millis');
            result = yield* engine.poll(conversationReplyWorkflow, receipt.executionId);
          }

          assert.ok(result.value._tag === 'Suspended');
          assert.strictEqual(calls, 0);
          const sourceEvent = context.db.orm
            .select()
            .from(tables.workflowEvents)
            .all()
            .filter((row) => row.payload !== '{}')
            .map((row) => decodeEvent(row.payload))
            .find((event) => event.type === 'SourceProcessingRequested');

          assertEventType(sourceEvent, 'SourceProcessingRequested', 'missing event');

          yield* engine.execute(sourceIngestionWorkflow, {
            executionId: 'ingestion',
            payload: { event: sourceEvent }
          });
          const indexed = context.db.orm
            .select()
            .from(tables.workflowEvents)
            .all()
            .filter((row) => row.payload !== '{}')
            .map((row) => decodeEvent(row.payload))
            .find((event) => event.type === 'SourceIndexed');

          assertEventType(indexed, 'SourceIndexed', 'missing index event');

          dispatchPending(
            context,
            conversationAttachmentWakeRegistration.triggers.filter(
              (trigger) => trigger.event === 'SourceIndexed'
            ),
            Date.now()
          );
          const wakeReceipt = context.db.orm
            .select()
            .from(tables.workflowReceipts)
            .where(eq(tables.workflowReceipts.eventId, indexed.eventId))
            .get()!;

          yield* engine.execute(conversationAttachmentWakeWorkflow, {
            executionId: wakeReceipt.executionId,
            payload: { event: indexed }
          });
          yield* engine.execute(conversationReplyWorkflow, {
            executionId: receipt.executionId,
            payload: { event: generation }
          });
          assert.strictEqual(calls, 1);
          const row = context.db.orm
            .select()
            .from(tables.conversation_reply_requests)
            .where(eq(tables.conversation_reply_requests.request_id, request.requestId))
            .get()!;
          const snapshot = JSON.parse(row.snapshot);

          assert.strictEqual(snapshot.pendingAttachments, undefined);
          assert.strictEqual(snapshot.messages[0].attachments.length, 1);

          const earlySession = yield* conversations.createSession({
            project: project.id,
            title: 'Early'
          });
          const earlySource = yield* createUnregisteredSource({
            projectId: project.id,
            name: 'early.txt',
            bytes: new TextEncoder().encode('Early')
          });

          const root = yield* conversations.postMessage({
            sessionId: earlySession.id,
            text: 'Root',
            sourceIds: [earlySource.id]
          });
          const threadRoot = root.parts[0]!.id;

          yield* conversations.postMessage({
            sessionId: earlySession.id,
            text: 'Question',
            threadRoot
          });
          const earlyRequest = yield* conversations.requestReply({
            sessionId: earlySession.id,
            threadRoot
          });
          const earlySnapshot = yield* conversations.replySnapshot({
            requestId: earlyRequest.requestId
          });

          assert.strictEqual(earlySnapshot.pendingAttachments?.[0]?.partId, threadRoot);
          const earlyIngestion = context.db.orm
            .select()
            .from(tables.workflowEvents)
            .all()
            .filter((row) => row.payload !== '{}')
            .map((item) => decodeEvent(item.payload))
            .find(
              (item) =>
                item.type === 'SourceProcessingRequested' && item.sourceId === earlySource.id
            );

          assertEventType(earlyIngestion, 'SourceProcessingRequested', 'missing ingestion');

          yield* engine.execute(sourceIngestionWorkflow, {
            executionId: 'early-ingestion',
            payload: { event: earlyIngestion }
          });
          const earlyIndex = context.db.orm
            .select()
            .from(tables.workflowEvents)
            .all()
            .filter((row) => row.payload !== '{}')
            .map((item) => decodeEvent(item.payload))
            .find((item) => item.type === 'SourceIndexed' && item.sourceId === earlySource.id);

          assertEventType(earlyIndex, 'SourceIndexed', 'missing index');

          yield* engine.execute(conversationAttachmentWakeWorkflow, {
            executionId: 'early-wake',
            payload: { event: earlyIndex }
          });
          dispatchPending(context, conversationReplyRegistration.triggers, Date.now());
          const earlyEventRow = context.db.orm
            .select()
            .from(tables.workflowEvents)
            .where(eq(tables.workflowEvents.correlationId, earlyRequest.requestId))
            .get()!;
          const earlyEvent = decodeEvent(earlyEventRow.payload);

          assertEventType(earlyEvent, 'ConversationGenerationRequested', 'wrong event');

          const earlyReceipt = context.db.orm
            .select()
            .from(tables.workflowReceipts)
            .where(eq(tables.workflowReceipts.eventId, earlyEvent.eventId))
            .get()!;

          yield* engine.execute(conversationReplyWorkflow, {
            executionId: earlyReceipt.executionId,
            payload: { event: earlyEvent }
          });
          assert.strictEqual(calls, 2);

          const failedSession = yield* conversations.createSession({
            project: project.id,
            title: 'Early failure'
          });
          const failedSource = yield* createUnregisteredSource({
            projectId: project.id,
            name: 'bad.bin',
            bytes: new Uint8Array([0, 1, 2])
          });

          yield* conversations.postMessage({
            sessionId: failedSession.id,
            text: 'Question',
            sourceIds: [failedSource.id]
          });
          const failedRequest = yield* conversations.requestReply({ sessionId: failedSession.id });
          const failedIngestion = context.db.orm
            .select()
            .from(tables.workflowEvents)
            .all()
            .filter((row) => row.payload !== '{}')
            .map((item) => decodeEvent(item.payload))
            .find(
              (item) =>
                item.type === 'SourceProcessingRequested' && item.sourceId === failedSource.id
            );

          assertEventType(failedIngestion, 'SourceProcessingRequested', 'missing ingestion');

          yield* Effect.flip(
            engine.execute(sourceIngestionWorkflow, {
              executionId: 'early-failure-ingestion',
              payload: { event: failedIngestion }
            })
          );
          const failureNotice = context.db.orm
            .select()
            .from(tables.workflowEvents)
            .all()
            .filter((row) => row.payload !== '{}')
            .map((item) => decodeEvent(item.payload))
            .find(
              (item) => item.type === 'SourceProcessingFailed' && item.sourceId === failedSource.id
            );

          assertEventType(failureNotice, 'SourceProcessingFailed', 'missing failure notice');

          yield* engine.execute(conversationAttachmentWakeWorkflow, {
            executionId: 'early-failure-wake',
            payload: { event: failureNotice }
          });
          dispatchPending(context, conversationReplyRegistration.triggers, Date.now());
          const failedRow = context.db.orm
            .select()
            .from(tables.workflowEvents)
            .where(eq(tables.workflowEvents.correlationId, failedRequest.requestId))
            .get()!;
          const failedEvent = decodeEvent(failedRow.payload);

          assert.ok(!(failedEvent.type !== 'ConversationGenerationRequested'), 'wrong event');

          const failedReceipt = context.db.orm
            .select()
            .from(tables.workflowReceipts)
            .where(eq(tables.workflowReceipts.eventId, failedEvent.eventId))
            .get()!;
          const earlyFailure = yield* Effect.flip(
            engine.execute(conversationReplyWorkflow, {
              executionId: failedReceipt.executionId,
              payload: { event: failedEvent }
            })
          );

          assert.ok(earlyFailure.kind === 'invalid_input');
          assert.strictEqual(calls, 2);

          for (const mode of [
            'delete',
            'replace',
            'reprocess',
            'unsupported',
            'later-pending',
            'ready-reference'
          ] as const) {
            yield* assertInvalidationResumesReply(mode);
          }

          function* assertInvalidationResumesReply(
            mode:
              | 'delete'
              | 'replace'
              | 'reprocess'
              | 'unsupported'
              | 'later-pending'
              | 'ready-reference'
          ) {
            const nextSession = yield* conversations.createSession({
              project: project.id,
              title: mode
            });
            const nextSource = yield* createUnregisteredSource({
              projectId: project.id,
              name: mode === 'unsupported' ? 'unknown.bin' : 'next.txt',
              bytes: new Uint8Array([0, 1, 2, 3])
            });

            const blocker =
              mode === 'later-pending' || mode === 'ready-reference'
                ? yield* createUnregisteredSource({
                    projectId: project.id,
                    name: 'blocker.txt',
                    bytes: new TextEncoder().encode('blocked')
                  })
                : undefined;

            if (mode === 'ready-reference') {
              const ingestion = context.db.orm
                .select()
                .from(tables.workflowEvents)
                .all()
                .filter((row) => row.payload !== '{}')
                .map((item) => decodeEvent(item.payload))
                .find(
                  (item) =>
                    item.type === 'SourceProcessingRequested' && item.sourceId === nextSource.id
                );

              assertEventType(ingestion, 'SourceProcessingRequested', 'missing ingestion');

              yield* engine.execute(sourceIngestionWorkflow, {
                executionId: 'ready-reference-source',
                payload: { event: ingestion }
              });
            }

            yield* conversations.postMessage({
              sessionId: nextSession.id,
              text: 'Question',
              sourceIds: blocker
                ? mode === 'later-pending'
                  ? [blocker.id, nextSource.id]
                  : [nextSource.id, blocker.id]
                : [nextSource.id]
            });
            const nextRequest = yield* conversations.requestReply({ sessionId: nextSession.id });
            const captured = yield* conversations.inspectReplySnapshot({
              requestId: nextRequest.requestId
            });

            dispatchPending(context, conversationReplyRegistration.triggers, Date.now());
            const eventRow = context.db.orm
              .select()
              .from(tables.workflowEvents)
              .where(eq(tables.workflowEvents.correlationId, nextRequest.requestId))
              .get()!;
            const nextEvent = decodeEvent(eventRow.payload);

            assert.ok(!(nextEvent.type !== 'ConversationGenerationRequested'), 'wrong event');

            const nextReceipt = context.db.orm
              .select()
              .from(tables.workflowReceipts)
              .where(eq(tables.workflowReceipts.eventId, nextEvent.eventId))
              .get()!;

            yield* engine.execute(conversationReplyWorkflow, {
              executionId: nextReceipt.executionId,
              payload: { event: nextEvent },
              discard: true
            });
            let nextResult = yield* engine.poll(conversationReplyWorkflow, nextReceipt.executionId);

            while (Option.isNone(nextResult)) {
              yield* Effect.sleep('10 millis');
              nextResult = yield* engine.poll(conversationReplyWorkflow, nextReceipt.executionId);
            }

            assert.ok(nextResult.value._tag === 'Suspended');

            if (['delete', 'later-pending', 'ready-reference'].includes(mode)) {
              assert.ok(
                (yield* Effect.flip(sources.deleteSource({ id: nextSource.id }))).kind ===
                  'invalid_input'
              );
              expect(
                yield* conversations.inspectReplySnapshot({ requestId: nextRequest.requestId })
              ).toStrictEqual(captured);
              yield* conversations.deleteSession(nextSession.id);
              assert.strictEqual(yield* sources.deleteSource({ id: nextSource.id }), true);
              assert.strictEqual(calls, 2);
              assert.strictEqual(
                context.db.orm
                  .select()
                  .from(tables.conversation_reply_requests)
                  .where(eq(tables.conversation_reply_requests.request_id, nextRequest.requestId))
                  .get(),
                undefined
              );

              return;
            }

            yield* invalidateSource();

            function* invalidateSource() {
              if (mode === 'replace')
                yield* sources.replaceSource({
                  id: nextSource.id,
                  expectedRevision: 1,
                  name: 'new.txt',
                  bytes: new TextEncoder().encode('new')
                });

              if (mode === 'reprocess') {
                yield* sources.requestSourceProcessing({ id: nextSource.id, expectedRevision: 1 });
                const replacement = yield* sources.sourceProcessing(nextSource.id);
                const accepted = captured.pendingAttachments![0]!;

                assert.strictEqual(BigInt(replacement.revision), accepted.inputRevision);
                assert.notStrictEqual(replacement.requestId, accepted.requestId);
                expect(
                  yield* conversations.inspectReplySnapshot({ requestId: nextRequest.requestId })
                ).toStrictEqual(captured);
              }

              if (mode === 'unsupported') {
                const ingestion = context.db.orm
                  .select()
                  .from(tables.workflowEvents)
                  .all()
                  .filter((row) => row.payload !== '{}')
                  .map((item) => decodeEvent(item.payload))
                  .find(
                    (item) =>
                      item.type === 'SourceProcessingRequested' && item.sourceId === nextSource.id
                  );

                assertEventType(ingestion, 'SourceProcessingRequested', 'missing ingestion');

                yield* Effect.flip(
                  engine.execute(sourceIngestionWorkflow, {
                    executionId: `ingestion-${mode}`,
                    payload: { event: ingestion }
                  })
                );
              }
            }

            const wake = context.db.orm
              .select()
              .from(tables.workflowEvents)
              .all()
              .filter((row) => row.payload !== '{}')
              .map((item) => decodeEvent(item.payload))
              .findLast(
                (item) =>
                  'sourceId' in item &&
                  item.sourceId === nextSource.id &&
                  (item.type === 'SourceDeleted' ||
                    item.type === 'SourceProcessingRequested' ||
                    item.type === 'SourceProcessingFailed')
              );

            assertWakeEvent(wake);

            yield* engine.execute(conversationAttachmentWakeWorkflow, {
              executionId: `wake-${mode}`,
              payload: { event: wake }
            });
            yield* assertReplyCompleted();

            function* assertReplyCompleted() {
              let completed = false;

              for (let i = 0; i < 100; i++) {
                const observed = yield* engine.poll(
                  conversationReplyWorkflow,
                  nextReceipt.executionId
                );

                if (Option.isSome(observed) && observed.value._tag === 'Complete') {
                  completed = true;
                  break;
                }

                yield* Effect.sleep('10 millis');
              }

              assert.ok(
                completed === true,
                `source invalidation must resume the blocked ${mode} reply`
              );
            }

            const error = yield* Effect.flip(
              engine.execute(conversationReplyWorkflow, {
                executionId: nextReceipt.executionId,
                payload: { event: nextEvent }
              })
            );

            assert.ok(error.kind === 'invalid_input');
            assert.strictEqual(calls, 2);
            assert.strictEqual(
              context.db.orm
                .select()
                .from(tables.conversation_reply_requests)
                .where(eq(tables.conversation_reply_requests.request_id, nextRequest.requestId))
                .get(),
              undefined
            );
          }
        }).pipe(Effect.provide(services))
      )
    );
  } finally {
    await auth.dispose();
    await new Promise<void>((resolve, reject) =>
      peer.close((error) => (error ? reject(error) : resolve()))
    );
    context.close();
    location.cleanup();
  }
});

testStable(
  'a pending reply survives reopening and protects its source until raw session deletion',
  async () => {
    const location = createTestDatabase();
    let context = new ServerContext(location.open());
    const auth = new AuthManager({ issuer: 'http://127.0.0.1', saveRefresh: async () => {} });
    const model = createChatGptModel({ auth, modelId: 'test', baseUrl: 'http://127.0.0.1' });
    const services = () => {
      const database = Layer.succeed(Database, { store: context });

      const engine = workflowEngineLayer(context);
      const control = Layer.effect(
        WorkflowControl,
        Effect.map(WorkflowEngine.WorkflowEngine, (engine) => ({
          cancel: (input: Parameters<typeof cancelExecution>[2]) =>
            cancelExecution(context, [conversationReplyWorkflow], input).pipe(
              Effect.provideService(WorkflowEngine.WorkflowEngine, engine)
            )
        }))
      ).pipe(Layer.provideMerge(engine));

      return Layer.mergeAll(
        database,
        Layer.merge(Conversations.layer, Sources.layer).pipe(Layer.provideMerge(database)),
        Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
        agentsLayer({
          model: () => Effect.succeed(model),
          language: 'en',
          searchSources: () => Effect.succeed([])
        }),
        control
      );
    };

    try {
      const saved = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const conversations = yield* Conversations;
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(conversationReplyWorkflow, conversationReplyHandler);
            const project = context.db.orm
              .insert(tables.projects)
              .values({ name: 'P', created_at: 1n, updated_at: 1n })
              .returning()
              .get();
            const session = yield* conversations.createSession({
              project: project.id,
              title: 'Chat'
            });
            const source = yield* createUnregisteredSource({
              projectId: project.id,
              name: 'pending.txt',
              bytes: new TextEncoder().encode('pending')
            });

            yield* conversations.postMessage({
              sessionId: session.id,
              text: 'Question',
              sourceIds: [source.id]
            });
            const request = yield* conversations.requestReply({ sessionId: session.id });

            dispatchPending(context, conversationReplyRegistration.triggers, Date.now());
            const receipt = context.db.orm
              .select()
              .from(tables.workflowReceipts)
              .where(eq(tables.workflowReceipts.subscription, 'conversation-reply'))
              .get()!;
            const event = decodeEvent(
              context.db.orm
                .select()
                .from(tables.workflowEvents)
                .where(eq(tables.workflowEvents.eventId, receipt.eventId))
                .get()!.payload
            );

            assertEventType(event, 'ConversationGenerationRequested', 'wrong event');

            yield* engine.execute(conversationReplyWorkflow, {
              executionId: receipt.executionId,
              payload: { event },
              discard: true
            });
            let result = yield* engine.poll(conversationReplyWorkflow, receipt.executionId);

            while (Option.isNone(result)) {
              yield* Effect.sleep('10 millis');
              result = yield* engine.poll(conversationReplyWorkflow, receipt.executionId);
            }

            assert.ok(result.value._tag === 'Suspended');

            return {
              sessionId: session.id,
              sourceId: source.id,
              request,
              event,
              executionId: receipt.executionId
            };
          }).pipe(Effect.provide(services()))
        )
      );

      context.close();
      context = new ServerContext(location.open());
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const sources = yield* Sources;
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(conversationReplyWorkflow, conversationReplyHandler);
            yield* engine.register(
              conversationAttachmentWakeWorkflow,
              conversationAttachmentWakeHandler
            );
            assert.ok(
              (yield* Effect.flip(sources.deleteSource({ id: saved.sourceId }))).kind ===
                'invalid_input'
            );
            const conversations = yield* Conversations;

            assert.ok(
              yield* conversations.inspectReplySnapshot({ requestId: saved.request.requestId })
            );
            yield* engine.register(sessionDeletionWorkflow, sessionDeletionHandler);
            yield* conversations.deleteSession(saved.sessionId);
            const cleanup = context.db.orm
              .select()
              .from(tables.workflowEvents)
              .all()
              .filter((row) => row.type === 'SessionDeletionRequested')
              .map((row) => decodeEvent(row.payload))
              .find(
                (event) =>
                  event.type === 'SessionDeletionRequested' && event.sessionId === saved.sessionId
              );

            assertEventType(cleanup, 'SessionDeletionRequested', 'missing cleanup event');
            yield* engine.execute(sessionDeletionWorkflow, {
              executionId: 'reopen-cleanup',
              payload: { event: cleanup }
            });
            assert.ok(workflowStore(context).execution(saved.executionId)?.status === 'cancelled');
            assert.strictEqual(yield* sources.deleteSource({ id: saved.sourceId }), true);
            const deleted = context.db.orm
              .select()
              .from(tables.workflowEvents)
              .all()
              .filter((row) => row.payload !== '{}')
              .map((row) => decodeEvent(row.payload))
              .find((event) => event.type === 'SourceDeleted' && event.sourceId === saved.sourceId);

            assertEventType(deleted, 'SourceDeleted', 'missing deletion');

            yield* engine.execute(conversationAttachmentWakeWorkflow, {
              executionId: 'reopen-wake',
              payload: { event: deleted }
            });
            assert.strictEqual(
              context.db.orm
                .select()
                .from(tables.conversation_reply_requests)
                .where(eq(tables.conversation_reply_requests.request_id, saved.request.requestId))
                .get(),
              undefined
            );
          }).pipe(Effect.provide(services()))
        )
      );
    } finally {
      await auth.dispose();
      context.close();
      location.cleanup();
    }
  }
);

function assertEventType<T extends ReturnType<typeof decodeEvent>['type']>(
  event: ReturnType<typeof decodeEvent> | undefined,
  type: T,
  message: string
): asserts event is Extract<ReturnType<typeof decodeEvent>, { type: T }> {
  assert.ok(event && event.type === type, message);
}

function assertWakeEvent(
  event: ReturnType<typeof decodeEvent> | undefined
): asserts event is Extract<
  ReturnType<typeof decodeEvent>,
  { type: 'SourceDeleted' | 'SourceProcessingRequested' | 'SourceProcessingFailed' }
> {
  assert.ok(
    event &&
      (event.type === 'SourceDeleted' ||
        event.type === 'SourceProcessingRequested' ||
        event.type === 'SourceProcessingFailed'),
    'missing wake'
  );
}
