import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StudyRpc } from '@study/contracts/rpc';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { Effect } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { App, serve } from '#server/runtime/index';

test(
  'a failed dispatcher tick recovers without restarting the application',
  { timeout: 5000 },
  async () => {
    const location = createTestDatabase();
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

          for (let i = 0; i < 100; i++) {
            const state = yield* client['sources.sourceProcessing']({ id: source.id });

            if (state.documentId !== null) {
              assert.ok(app.workers.started);

              return;
            }

            yield* Effect.sleep('5 millis');
          }

          throw new Error('Worker did not recover after dispatch became available');
        }).pipe(Effect.scoped)
      );
    } finally {
      await server.close();
      await app.close();
      location.cleanup();
    }
  }
);
