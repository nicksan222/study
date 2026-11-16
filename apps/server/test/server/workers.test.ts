import { StudyRpc } from '@study/contracts';
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
import { sql } from '@study/db';
import { test } from '@study/testing';
import { Effect } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { serve } from '#server/runtime/index';

test.stable(
  'source workflow survives restart and makes its content discoverable',
  { timeout: 15000 },
  async ({ resources: location }) => {
    let app = await location.openApp({ path: location.path });
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

      test.assert.strictEqual(app.store.db.orm.all(sql`SELECT * FROM workflow_events`).length, 1);
      await server.close();
      await app.close();
      app = await location.openApp({ path: location.path });
      server = await serve(app);
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });

            yield* client['system.startWorkers']({});
            test.assert.ok((yield* client['system.health']({})).workersRunning === true);

            yield* test.pollUntil(
              client['sources.sourceProcessing']({ id: source.id }),
              (value) => value.documentId !== null,
              { attempts: 100, interval: '50 millis', message: 'source workflow did not recover' }
            );

            const search = yield* client['system.search']({ query: 'gravity', limit: 10 });

            test.assert.ok(
              search.hits.some(
                (hit) => hit.target.type === 'source' && hit.target.sourceId === source.id
              )
            );
            yield* client['system.stopWorkers']({});
            test.assert.ok((yield* client['system.health']({})).workersRunning === false);

            return;
          })
        )
      );
      test.assert.ok(app.store.db.orm.all(sql`SELECT * FROM workflow_receipts`).length > 0);
      test.assert.ok(
        app.store.db.orm.all(sql`SELECT * FROM workflow_executions WHERE status = 'completed'`)
          .length > 0
      );
    } finally {
      await server.close();
      await app.close();
      await location.close();
    }
  }
);

test.stable(
  'reply workflow records a durable sign-in wait across restart',
  { timeout: 15000 },
  async ({ resources: location }) => {
    let app = await location.openApp({ path: location.path });
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

            yield* test.pollUntil(
              Effect.sync(
                () =>
                  app.store.db.orm.all(
                    sql`SELECT w.execution_id FROM workflow_configuration_waits w JOIN workflow_executions e ON e.execution_id = w.execution_id WHERE e.workflow_tag = 'conversation-reply/v1'`
                  ).length
              ),
              (value) => value > 0,
              {
                attempts: 100,
                interval: '50 millis',
                message: 'reply workflow did not wait for sign-in'
              }
            );

            const message = yield* client['notes.message']({ id: request.messageId });

            test.assert.ok(
              message.versions.find((version) => version.id === request.versionId)?.status ===
                'pending'
            );

            return;
          })
        )
      );
      await server.close();
      await app.close();
      app = await location.openApp({ path: location.path });
      server = await serve(app);
      test.assert.strictEqual(
        app.store.db.orm.all(
          sql`SELECT w.execution_id FROM workflow_configuration_waits w JOIN workflow_executions e ON e.execution_id = w.execution_id WHERE e.workflow_tag = 'conversation-reply/v1'`
        ).length,
        1
      );
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });

            test.assert.strictEqual(yield* client['auth.publicAccount']({}), undefined);
          })
        )
      );
    } finally {
      await server.close();
      await app.close();
      await location.close();
    }
  }
);
