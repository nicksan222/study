/** @file Composes synchronous official SQL storage transactions beside the domain connection. */

import { SqliteClient } from '@effect/sql-sqlite-bun';
import { Context, Effect, Layer, References } from 'effect';
import { SqlClient } from 'effect/sql';

/**
 * Keeps audited synchronous official storage transactions together on Bun's event loop.
 * A suspended writer would block synchronous domain SQLite calls on the same thread.
 * This does not coordinate genuinely asynchronous transaction bodies; workflow storage
 * must not wrap asynchronous activities with ClusterSchema.WithTransaction.
 */
export function workflowSqlClientLayer(filename: string) {
  return Layer.effectContext(
    Effect.gen(function* () {
      const client = yield* SqliteClient.SqliteClient;
      const transact = client.withTransaction;
      const withTransaction: typeof transact = (self) =>
        transact(self).pipe(Effect.provideService(References.PreventSchedulerYield, true));

      // Retain the callable client and its aliases, including withoutTransforms().
      Object.assign(client, { withTransaction });

      return Context.make(SqliteClient.SqliteClient, client).pipe(
        Context.add(SqlClient.SqlClient, client)
      );
    })
  ).pipe(Layer.provide(SqliteClient.layer({ filename })));
}
