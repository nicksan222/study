/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Requests reply and title generation over native RPC while signed out and verifies  │
 * │ both enter durable configuration waits without scheduled clocks. Conversation messages   │
 * │ remain pending and visible.                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Covers durable sign-in waits, atomic Ask reopen and exact reply provenance.            │
 * │ - Exercises bounded Material-only search through the native service composition.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/client/index, #server/runtime/index with real SQLite and application        │
 * │ resources; fixture cleanup closes owned resources.                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyRpc } from '@study/contracts/rpc';
import { materialSearchInputSchema } from '@study/contracts/system/rpc';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Schema } from 'effect';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';
import { App, serve } from '#server/runtime/index';

testStable(
  'a reply requested over RPC reaches the durable sign-in wait',
  { timeout: 10000 },
  async () => {
    const location = createTestDatabase();
    const app = await App.open({ path: location.path });
    const server = await serve(app);

    await app.workers.start();

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const project = yield* client['projects.createProject']({ name: 'Conversation' });
            const session = yield* client['conversations.createSession']({
              project: project.id,
              title: 'Chat'
            });

            yield* client['conversations.postMessage']({
              sessionId: session.id,
              text: 'Explain ATP'
            });
            const request = yield* client['conversations.requestReply']({ sessionId: session.id });
            let waiting = false;

            for (let i = 0; i < 100; i++) {
              const rows = app.store.db.orm.all(
                sql`SELECT w.execution_id FROM workflow_configuration_waits w JOIN workflow_executions e ON e.execution_id=w.execution_id WHERE e.workflow_tag='conversation-reply/v1'`
              );

              if (rows.length === 1) {
                waiting = true;
                break;
              }

              yield* Effect.sleep('50 millis');
            }

            assert.ok(waiting, 'reply must wait durably for account setup');
            assert.strictEqual(app.store.db.orm.all(sql`SELECT * FROM workflow_clocks`).length, 0);
            const untitled = yield* client['conversations.createUntitledSession']({
              project: project.id
            });

            yield* client['conversations.postMessage']({
              sessionId: untitled.id,
              text: 'Study photosynthesis'
            });
            yield* client['conversations.requestTitle']({ sessionId: untitled.id });
            let titleWaiting = false;

            for (let i = 0; i < 100; i++) {
              if (
                app.store.db.orm.all(
                  sql`SELECT w.execution_id FROM workflow_configuration_waits w JOIN workflow_executions e ON e.execution_id=w.execution_id WHERE e.workflow_tag='conversation-title/v1'`
                ).length === 1
              ) {
                titleWaiting = true;
                break;
              }

              yield* Effect.sleep('50 millis');
            }

            assert.ok(titleWaiting, 'title request must enter durable configuration wait');

            const message = yield* client['conversations.message']({ id: request.messageId });

            assert.ok(
              message.versions.find((version) => version.id === request.versionId)?.status ===
                'pending'
            );
            assert.strictEqual(
              (yield* client['conversations.thread']({ sessionId: session.id, limit: 10 })).items
                .length,
              2
            );
          })
        )
      );
    } finally {
      await server.close();
      await app.close();
      location.cleanup();
    }
  }
);

testStable(
  'atomic Ask returns its note and exact request over native HTTP RPC after process reopen',
  async () => {
    const location = createTestDatabase();
    let app = await App.open({ path: location.path });
    let server = await serve(app);

    try {
      const saved = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const session = yield* client['conversations.createSession']({ title: 'Atomic Ask' });
            const input = {
              sessionId: session.id,
              intentKey: 'native-ask',
              expectedSelectionRevision: 0n,
              text: 'Exact note'
            };
            const result = yield* client['conversations.ask'](input);

            assert.strictEqual(
              (yield* client['conversations.message']({ id: result.userMessageId }))
                .activeVersionId,
              result.userVersionId
            );
            expect(yield* client['conversations.ask'](input)).toStrictEqual(result);

            return { input, result };
          })
        )
      );

      await server.close();
      await app.close();
      app = await App.open({ path: location.path });
      server = await serve(app);
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });

            expect(yield* client['conversations.ask'](saved.input)).toStrictEqual(saved.result);
            expect(
              yield* client['conversations.replyVersion']({
                sessionId: saved.input.sessionId,
                messageId: saved.result.messageId,
                versionId: saved.result.versionId
              })
            ).toStrictEqual({ state: 'available', requestId: saved.result.requestId });
            assert.strictEqual(
              (yield* client['conversations.thread']({
                sessionId: saved.input.sessionId,
                limit: 10
              })).items.length,
              2
            );
          })
        )
      );
    } finally {
      await server.close();
      await app.close();
      location.cleanup();
    }
  }
);

testStable(
  'native Material search binds bounded canonical targets without mixing catalog kinds',
  async () => {
    const location = createTestDatabase();
    const app = await App.open({ path: location.path });
    const server = await serve(app);

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const project = yield* client['projects.createProject']({ name: 'NativeSearchToken' });
            const material = yield* client['materials.create']({
              title: 'NativeSearchToken',
              content: { kind: 'diagram', format: 'mermaid', payload: 'graph TD; A-->B' },
              publish: true
            });
            const found = yield* client['system.materialSearch'](
              Schema.decodeUnknownSync(materialSearchInputSchema)({
                query: '  NativeSearchToken  ',
                limit: 1
              })
            );

            assert.ok(found.semantic === false);
            assert.strictEqual(found.hits.length, 1);
            assert.ok(found.hits[0]?.kind === 'material');
            expect(found.hits[0]?.target).toStrictEqual({
              type: 'material',
              materialId: material.id,
              versionId: material.version.id,
              materialKind: 'diagram'
            });
            expect(
              yield* client['system.materialSearch']({
                query: 'NativeSearchToken',
                limit: 1,
                project: project.id
              })
            ).toStrictEqual({ semantic: false, hits: [] });
          })
        )
      );
    } finally {
      await server.close();
      await app.close();
      location.cleanup();
    }
  }
);
