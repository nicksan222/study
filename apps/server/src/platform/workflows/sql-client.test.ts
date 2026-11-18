import { SqliteClient } from '@effect/sql-sqlite-bun';
import { sql } from '@study/db';
import { test } from '@study/testing';
import { Deferred, Effect, Fiber, References } from 'effect';
import { SqlClient } from 'effect/sql';

import { workflowSqlClientLayer } from './sql-client.ts';

test.server.stable(
  'workflow SQL commits synchronous storage before queued domain work under scheduler pressure',
  async ({ databases, assert: assertions }) => {
    const assert: test.Assert = assertions;
    const location = await databases();
    const db = await location.open();

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const provided = yield* SqlClient.SqlClient;
          const client = provided.withoutTransforms();

          assert.strictEqual(client, provided);
          assert.strictEqual(client, yield* SqliteClient.SqliteClient);
          assert.strictEqual(client.safe, client);
          yield* client`CREATE TABLE scheduler_contention (id INTEGER PRIMARY KEY)`;
          const written = yield* Deferred.make<void>();
          const writer = yield* client
            .withTransaction(
              Effect.gen(function* () {
                yield* client`INSERT INTO scheduler_contention VALUES (1)`;
                yield* Deferred.succeed(written, undefined);

                for (let index = 0; index < 32; index++)
                  yield* client`SELECT id FROM scheduler_contention`;
              })
            )
            .pipe(Effect.provideService(References.MaxOpsBeforeYield, 128), Effect.forkChild);

          yield* Deferred.await(written);
          // Deferred resumes waiters inline. Queue this independent consumer outside the SQL transaction.
          yield* Effect.yieldNow;
          const rows = db.transaction((tx) => tx.orm.all(sql`SELECT id FROM scheduler_contention`));

          assert.deepEqual(rows, [{ id: 1n }]);
          yield* Fiber.join(writer);
          const rollback = new Error('Rollback this storage write');
          const failure = yield* client
            .withTransaction(
              client`INSERT INTO scheduler_contention VALUES (2)`.pipe(
                Effect.andThen(Effect.fail(rollback))
              )
            )
            .pipe(Effect.flip);

          assert.strictEqual(failure, rollback);
          assert.strictEqual(yield* References.PreventSchedulerYield, false);
          assert.deepEqual(
            db.transaction((tx) => tx.orm.all(sql`SELECT id FROM scheduler_contention`)),
            [{ id: 1n }]
          );
        }).pipe(Effect.provide(workflowSqlClientLayer(location.path)), Effect.scoped)
      );
    } finally {
      db.close();
      await location.cleanup();
    }
  }
);
