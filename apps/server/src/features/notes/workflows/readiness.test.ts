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

import { defaultAgentRules } from '@study/contracts/settings/types';
import { eq } from '@study/db';
import * as tables from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Option } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Notes } from '#server/features/notes/service/index';
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

import { noteDeletionWorkflow, noteDeletionHandler } from './deletion.ts';
import {
  noteReplyHandler,
  noteReplyWorkflow,
  noteReplyRegistration,
  noteAttachmentWakeHandler,
  noteAttachmentWakeWorkflow,
  noteAttachmentWakeRegistration
} from './index.ts';

testStable('indexed source wakes the dispatched reply using its persisted receipt', async () => {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
  let calls = 0;
  const peer = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      let events = '';

      await request.text();

      calls++;

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
        events += `data: ${JSON.stringify(event)}\n\n`;

      return new Response(events + 'data: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' }
      });
    }
  });

  assert.ok(peer.port, 'missing address');
  const base = peer.url.origin;
  const auth = new AuthManager({ issuer: base, saveRefresh: async () => {} });

  await auth.replace(
    { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
    { accessToken: 'token', expiresIn: 3600 }
  );
  const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
  const database = Layer.succeed(Database, { store: context });
  const services = Layer.mergeAll(
    database,
    Layer.merge(Notes.layer, Sources.layer).pipe(Layer.provideMerge(database)),
    Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
    agentsLayer({
      model: () => Effect.succeed(model),
      language: 'en',
      rules: Effect.succeed(defaultAgentRules),
      searchSources: () => Effect.succeed([])
    }),
    workflowEngineLayer(context)
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const notes = yield* Notes;
          const sources = yield* Sources;
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(noteReplyWorkflow, noteReplyHandler);
          yield* engine.register(noteAttachmentWakeWorkflow, noteAttachmentWakeHandler);
          yield* engine.register(sourceIngestionWorkflow, sourceIngestionHandler);
          const project = context.db.orm
            .insert(tables.projects)
            .values({ name: 'P', created_at: 1n, updated_at: 1n })
            .returning()
            .get();
          const note = yield* notes.createNote({
            project: project.id,
            title: 'Chat'
          });
          const source = yield* createUnregisteredSource({
            projectId: project.id,
            name: 'note.txt',
            bytes: new TextEncoder().encode('Hello')
          });

          yield* notes.postMessage({
            noteId: note.id,
            text: 'Question',
            sourceIds: [source.id]
          });
          const request = yield* notes.requestReply({ noteId: note.id });

          assert.strictEqual(
            (yield* notes.replyReadiness({ requestId: request.requestId })).length,
            1
          );
          assert.strictEqual(
            dispatchPending(context, noteReplyRegistration.triggers, Date.now()),
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

          assertEventType(generation, 'NoteGenerationRequested', 'wrong event');

          yield* engine.execute(noteReplyWorkflow, {
            executionId: receipt.executionId,
            payload: { event: generation },
            discard: true
          });
          let result = yield* engine.poll(noteReplyWorkflow, receipt.executionId);

          while (Option.isNone(result)) {
            yield* Effect.sleep('10 millis');
            result = yield* engine.poll(noteReplyWorkflow, receipt.executionId);
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
            noteAttachmentWakeRegistration.triggers.filter(
              (trigger) => trigger.event === 'SourceIndexed'
            ),
            Date.now()
          );
          const wakeReceipt = context.db.orm
            .select()
            .from(tables.workflowReceipts)
            .where(eq(tables.workflowReceipts.eventId, indexed.eventId))
            .get()!;

          yield* engine.execute(noteAttachmentWakeWorkflow, {
            executionId: wakeReceipt.executionId,
            payload: { event: indexed }
          });
          yield* engine.execute(noteReplyWorkflow, {
            executionId: receipt.executionId,
            payload: { event: generation }
          });
          assert.strictEqual(calls, 1);
          const row = context.db.orm
            .select()
            .from(tables.note_reply_requests)
            .where(eq(tables.note_reply_requests.request_id, request.requestId))
            .get()!;
          const snapshot = JSON.parse(row.snapshot);

          assert.strictEqual(snapshot.pendingAttachments, undefined);
          assert.strictEqual(snapshot.messages[0].attachments.length, 1);

          const earlyNote = yield* notes.createNote({
            project: project.id,
            title: 'Early'
          });
          const earlySource = yield* createUnregisteredSource({
            projectId: project.id,
            name: 'early.txt',
            bytes: new TextEncoder().encode('Early')
          });

          const root = yield* notes.postMessage({
            noteId: earlyNote.id,
            text: 'Root',
            sourceIds: [earlySource.id]
          });
          const threadRoot = root.parts[0]!.id;

          yield* notes.postMessage({
            noteId: earlyNote.id,
            text: 'Question',
            threadRoot
          });
          const earlyRequest = yield* notes.requestReply({
            noteId: earlyNote.id,
            threadRoot
          });
          const earlySnapshot = yield* notes.replySnapshot({
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

          yield* engine.execute(noteAttachmentWakeWorkflow, {
            executionId: 'early-wake',
            payload: { event: earlyIndex }
          });
          dispatchPending(context, noteReplyRegistration.triggers, Date.now());
          const earlyEventRow = context.db.orm
            .select()
            .from(tables.workflowEvents)
            .where(eq(tables.workflowEvents.correlationId, earlyRequest.requestId))
            .get()!;
          const earlyEvent = decodeEvent(earlyEventRow.payload);

          assertEventType(earlyEvent, 'NoteGenerationRequested', 'wrong event');

          const earlyReceipt = context.db.orm
            .select()
            .from(tables.workflowReceipts)
            .where(eq(tables.workflowReceipts.eventId, earlyEvent.eventId))
            .get()!;

          yield* engine.execute(noteReplyWorkflow, {
            executionId: earlyReceipt.executionId,
            payload: { event: earlyEvent }
          });
          assert.strictEqual(calls, 2);

          const failedNote = yield* notes.createNote({
            project: project.id,
            title: 'Early failure'
          });
          const failedSource = yield* createUnregisteredSource({
            projectId: project.id,
            name: 'bad.bin',
            bytes: new Uint8Array([0, 1, 2])
          });

          yield* notes.postMessage({
            noteId: failedNote.id,
            text: 'Question',
            sourceIds: [failedSource.id]
          });
          const failedRequest = yield* notes.requestReply({ noteId: failedNote.id });
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

          yield* engine.execute(noteAttachmentWakeWorkflow, {
            executionId: 'early-failure-wake',
            payload: { event: failureNotice }
          });
          dispatchPending(context, noteReplyRegistration.triggers, Date.now());
          const failedRow = context.db.orm
            .select()
            .from(tables.workflowEvents)
            .where(eq(tables.workflowEvents.correlationId, failedRequest.requestId))
            .get()!;
          const failedEvent = decodeEvent(failedRow.payload);

          assert.ok(!(failedEvent.type !== 'NoteGenerationRequested'), 'wrong event');

          const failedReceipt = context.db.orm
            .select()
            .from(tables.workflowReceipts)
            .where(eq(tables.workflowReceipts.eventId, failedEvent.eventId))
            .get()!;
          const earlyFailure = yield* Effect.flip(
            engine.execute(noteReplyWorkflow, {
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
            const nextNote = yield* notes.createNote({
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

            yield* notes.postMessage({
              noteId: nextNote.id,
              text: 'Question',
              sourceIds: blocker
                ? mode === 'later-pending'
                  ? [blocker.id, nextSource.id]
                  : [nextSource.id, blocker.id]
                : [nextSource.id]
            });
            const nextRequest = yield* notes.requestReply({ noteId: nextNote.id });
            const captured = yield* notes.inspectReplySnapshot({
              requestId: nextRequest.requestId
            });

            dispatchPending(context, noteReplyRegistration.triggers, Date.now());
            const eventRow = context.db.orm
              .select()
              .from(tables.workflowEvents)
              .where(eq(tables.workflowEvents.correlationId, nextRequest.requestId))
              .get()!;
            const nextEvent = decodeEvent(eventRow.payload);

            assert.ok(!(nextEvent.type !== 'NoteGenerationRequested'), 'wrong event');

            const nextReceipt = context.db.orm
              .select()
              .from(tables.workflowReceipts)
              .where(eq(tables.workflowReceipts.eventId, nextEvent.eventId))
              .get()!;

            yield* engine.execute(noteReplyWorkflow, {
              executionId: nextReceipt.executionId,
              payload: { event: nextEvent },
              discard: true
            });
            let nextResult = yield* engine.poll(noteReplyWorkflow, nextReceipt.executionId);

            while (Option.isNone(nextResult)) {
              yield* Effect.sleep('10 millis');
              nextResult = yield* engine.poll(noteReplyWorkflow, nextReceipt.executionId);
            }

            assert.ok(nextResult.value._tag === 'Suspended');

            if (['delete', 'later-pending', 'ready-reference'].includes(mode)) {
              assert.ok(
                (yield* Effect.flip(sources.deleteSource({ id: nextSource.id }))).kind ===
                  'invalid_input'
              );
              expect(
                yield* notes.inspectReplySnapshot({ requestId: nextRequest.requestId })
              ).toStrictEqual(captured);
              yield* notes.deleteNote(nextNote.id);
              assert.strictEqual(yield* sources.deleteSource({ id: nextSource.id }), true);
              assert.strictEqual(calls, 2);
              assert.strictEqual(
                context.db.orm
                  .select()
                  .from(tables.note_reply_requests)
                  .where(eq(tables.note_reply_requests.request_id, nextRequest.requestId))
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
                  yield* notes.inspectReplySnapshot({ requestId: nextRequest.requestId })
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

            yield* engine.execute(noteAttachmentWakeWorkflow, {
              executionId: `wake-${mode}`,
              payload: { event: wake }
            });
            yield* assertReplyCompleted();

            function* assertReplyCompleted() {
              let completed = false;

              for (let i = 0; i < 100; i++) {
                const observed = yield* engine.poll(noteReplyWorkflow, nextReceipt.executionId);

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
              engine.execute(noteReplyWorkflow, {
                executionId: nextReceipt.executionId,
                payload: { event: nextEvent }
              })
            );

            assert.ok(error.kind === 'invalid_input');
            assert.strictEqual(calls, 2);
            assert.strictEqual(
              context.db.orm
                .select()
                .from(tables.note_reply_requests)
                .where(eq(tables.note_reply_requests.request_id, nextRequest.requestId))
                .get(),
              undefined
            );
          }
        }).pipe(Effect.provide(services))
      )
    );
  } finally {
    await auth.dispose();
    await peer.stop(true);
    context.close();
    await location.cleanup();
  }
});

testStable(
  'a pending reply survives reopening and protects its source until raw note deletion',
  async () => {
    const location = await createTestDatabase();
    let context = new ServerContext(await location.open());
    const auth = new AuthManager({ issuer: 'http://127.0.0.1', saveRefresh: async () => {} });
    const model = createChatGptModel({ auth, modelId: 'test', baseUrl: 'http://127.0.0.1' });
    const services = () => {
      const database = Layer.succeed(Database, { store: context });

      const engine = workflowEngineLayer(context);
      const control = Layer.effect(
        WorkflowControl,
        Effect.map(WorkflowEngine.WorkflowEngine, (engine) => ({
          cancel: (input: Parameters<typeof cancelExecution>[2]) =>
            cancelExecution(context, [noteReplyWorkflow], input).pipe(
              Effect.provideService(WorkflowEngine.WorkflowEngine, engine)
            )
        }))
      ).pipe(Layer.provideMerge(engine));

      return Layer.mergeAll(
        database,
        Layer.merge(Notes.layer, Sources.layer).pipe(Layer.provideMerge(database)),
        Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
        agentsLayer({
          model: () => Effect.succeed(model),
          language: 'en',
          rules: Effect.succeed(defaultAgentRules),
          searchSources: () => Effect.succeed([])
        }),
        control
      );
    };

    try {
      const saved = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const notes = yield* Notes;
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(noteReplyWorkflow, noteReplyHandler);
            const project = context.db.orm
              .insert(tables.projects)
              .values({ name: 'P', created_at: 1n, updated_at: 1n })
              .returning()
              .get();
            const note = yield* notes.createNote({
              project: project.id,
              title: 'Chat'
            });
            const source = yield* createUnregisteredSource({
              projectId: project.id,
              name: 'pending.txt',
              bytes: new TextEncoder().encode('pending')
            });

            yield* notes.postMessage({
              noteId: note.id,
              text: 'Question',
              sourceIds: [source.id]
            });
            const request = yield* notes.requestReply({ noteId: note.id });

            dispatchPending(context, noteReplyRegistration.triggers, Date.now());
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

            assertEventType(event, 'NoteGenerationRequested', 'wrong event');

            yield* engine.execute(noteReplyWorkflow, {
              executionId: receipt.executionId,
              payload: { event },
              discard: true
            });
            let result = yield* engine.poll(noteReplyWorkflow, receipt.executionId);

            while (Option.isNone(result)) {
              yield* Effect.sleep('10 millis');
              result = yield* engine.poll(noteReplyWorkflow, receipt.executionId);
            }

            assert.ok(result.value._tag === 'Suspended');

            return {
              noteId: note.id,
              sourceId: source.id,
              request,
              event,
              executionId: receipt.executionId
            };
          }).pipe(Effect.provide(services()))
        )
      );

      context.close();
      context = new ServerContext(await location.open());
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const sources = yield* Sources;
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(noteReplyWorkflow, noteReplyHandler);
            yield* engine.register(noteAttachmentWakeWorkflow, noteAttachmentWakeHandler);
            assert.ok(
              (yield* Effect.flip(sources.deleteSource({ id: saved.sourceId }))).kind ===
                'invalid_input'
            );
            const notes = yield* Notes;

            assert.ok(yield* notes.inspectReplySnapshot({ requestId: saved.request.requestId }));
            yield* engine.register(noteDeletionWorkflow, noteDeletionHandler);
            yield* notes.deleteNote(saved.noteId);
            const cleanup = context.db.orm
              .select()
              .from(tables.workflowEvents)
              .all()
              .filter((row) => row.type === 'NoteDeletionRequested')
              .map((row) => decodeEvent(row.payload))
              .find(
                (event) => event.type === 'NoteDeletionRequested' && event.noteId === saved.noteId
              );

            assertEventType(cleanup, 'NoteDeletionRequested', 'missing cleanup event');
            yield* engine.execute(noteDeletionWorkflow, {
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

            yield* engine.execute(noteAttachmentWakeWorkflow, {
              executionId: 'reopen-wake',
              payload: { event: deleted }
            });
            assert.strictEqual(
              context.db.orm
                .select()
                .from(tables.note_reply_requests)
                .where(eq(tables.note_reply_requests.request_id, saved.request.requestId))
                .get(),
              undefined
            );
          }).pipe(Effect.provide(services()))
        )
      );
    } finally {
      await auth.dispose();
      context.close();
      await location.cleanup();
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
