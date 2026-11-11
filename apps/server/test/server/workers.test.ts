/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies source processing and note reply workflows survive application            │
 * │ restarts. Durable event receipts and execution state are checked alongside worker health │
 * │ and search visibility.                                                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: source workflow survives restart and makes its content discoverable; reply    │
 * │   workflow records a durable sign-in wait across restart.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/client/index, #server/runtime/index with real SQLite and application        │
 * │ resources; fixture cleanup closes owned resources.                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyRpc } from '@study/contracts/rpc';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { assert } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';
import { App, serve } from '#server/runtime/index';

testStable(
  'source workflow survives restart and makes its content discoverable',
  { timeout: 15000 },
  async () => {
    const location = await createTestDatabase();
    let app = await App.open({ path: location.path });
    let server = await serve(app);

    try {
      const source = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const project = yield* client['projects.createProject']({ name: 'Physics' });

            return yield* client['sources.createSource']({
              projectId: project.id,
              name: 'gravity.txt',
              bytes: new TextEncoder().encode('Gravity attracts masses.')
            });
          })
        )
      );

      assert.strictEqual(app.store.db.orm.all(sql`SELECT * FROM workflow_events`).length, 1);
      await server.close();
      await app.close();
      app = await App.open({ path: location.path });
      server = await serve(app);
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });

            yield* client['system.startWorkers']({});
            assert.ok((yield* client['system.health']({})).workersRunning === true);

            for (let i = 0; i < 100; i++) {
              const state = yield* client['sources.sourceProcessing']({ id: source.id });

              if (state.documentId !== null) {
                const search = yield* client['system.search']({ query: 'gravity', limit: 10 });

                assert.ok(
                  search.hits.some(
                    (hit) => hit.target.type === 'source' && hit.target.sourceId === source.id
                  )
                );
                yield* client['system.stopWorkers']({});
                assert.ok((yield* client['system.health']({})).workersRunning === false);

                return;
              }

              yield* Effect.sleep('50 millis');
            }

            assert.fail('source workflow did not recover');
          })
        )
      );
      assert.ok(app.store.db.orm.all(sql`SELECT * FROM workflow_receipts`).length > 0);
      assert.ok(
        app.store.db.orm.all(sql`SELECT * FROM workflow_executions WHERE status = 'completed'`)
          .length > 0
      );
    } finally {
      await server.close();
      await app.close();
      await location.cleanup();
    }
  }
);

testStable(
  'reply workflow records a durable sign-in wait across restart',
  { timeout: 15000 },
  async () => {
    const location = await createTestDatabase();
    let app = await App.open({ path: location.path });
    let server = await serve(app);

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const project = yield* client['projects.createProject']({ name: 'Physics' });
            const note = yield* client['notes.createNote']({
              project: project.id,
              title: 'Notes'
            });

            yield* client['notes.postMessage']({
              noteId: note.id,
              text: 'Explain gravity'
            });
            const request = yield* client['notes.requestReply']({ noteId: note.id });

            yield* client['system.startWorkers']({});

            for (let i = 0; i < 100; i++) {
              if (
                app.store.db.orm.all(
                  sql`SELECT w.execution_id FROM workflow_configuration_waits w JOIN workflow_executions e ON e.execution_id = w.execution_id WHERE e.workflow_tag = 'conversation-reply/v1'`
                ).length
              ) {
                const message = yield* client['notes.message']({ id: request.messageId });

                assert.ok(
                  message.versions.find((version) => version.id === request.versionId)?.status ===
                    'pending'
                );

                return;
              }

              yield* Effect.sleep('50 millis');
            }

            assert.fail('reply workflow did not wait for sign-in');
          })
        )
      );
      await server.close();
      await app.close();
      app = await App.open({ path: location.path });
      server = await serve(app);
      assert.strictEqual(
        app.store.db.orm.all(
          sql`SELECT w.execution_id FROM workflow_configuration_waits w JOIN workflow_executions e ON e.execution_id = w.execution_id WHERE e.workflow_tag = 'conversation-reply/v1'`
        ).length,
        1
      );
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });

            assert.strictEqual(yield* client['auth.publicAccount']({}), undefined);
          })
        )
      );
    } finally {
      await server.close();
      await app.close();
      await location.cleanup();
    }
  }
);
