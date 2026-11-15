/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Makes a workflow dispatcher tick fail through a temporary SQLite trigger, then     │
 * │ removes the failure and wakes the worker. The persisted source request must recover      │
 * │ without restarting the application.                                                      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: a failed dispatcher tick recovers without restarting the application.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/client/index, #server/runtime/index with real SQLite and application        │
 * │ resources; fixture cleanup closes owned resources.                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyRpc } from '@study/contracts';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { assert } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';
import { App, serve } from '#server/runtime/index';
import { pollUntil } from '#testing/poll';

testStable(
  'a failed dispatcher tick recovers without restarting the application',
  { timeout: 5000 },
  async () => {
    const location = await createTestDatabase();
    const app = await App.open({ path: location.path });
    const server = await serve(app);

    try {
      app.store.db.orm.run(
        sql`CREATE TRIGGER fail_dispatch BEFORE INSERT ON workflow_executions BEGIN SELECT RAISE(ABORT, 'temporarily unavailable'); END`
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
          const source = yield* client['sources.createSource']({
            name: 'notes.txt',
            bytes: new TextEncoder().encode('Durable input'),
            projectId: null
          });

          yield* Effect.promise(() => app.workers.start());
          yield* Effect.sleep('50 millis');
          app.store.db.orm.run(sql`DROP TRIGGER fail_dispatch`);
          app.workers.wake();

          yield* pollUntil(
            client['sources.sourceProcessing']({ id: source.id }),
            (value) => value.documentId !== null,
            {
              attempts: 100,
              interval: '5 millis',
              message: 'Worker did not recover after dispatch became available'
            }
          );
          assert.ok(app.workers.started);
        }).pipe(Effect.scoped)
      );
    } finally {
      await server.close();
      await app.close();
      await location.cleanup();
    }
  }
);
