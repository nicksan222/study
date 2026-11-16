import { sourceIdSchema } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies the native Node RPC listener reaches source SQLite transactions,          │
 * │ preserves typed lookup and revision failures, and commits workflow events. Closing the   │
 * │ scoped listener releases its endpoint and rejects untrusted origins.                     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: native scoped HTTP RPC reaches Source SQLite transactions and closes its      │
 * │   listener.                                                                              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/client/index, #server/features/sources/rpc/index,                           │
 * │ #server/features/sources/service/index with real SQLite and application resources;       │
 * │ fixture cleanup closes owned resources.                                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { SourcesRpc } from '@study/contracts';
import { workflowEvents } from '@study/db';
import { test } from '@study/testing';
import { Effect, Layer, Option, Schema } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { SourcesRpcLive } from '#server/features/sources/rpc/index';
import { Sources } from '#server/features/sources/service/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { serveRpc } from '#server/platform/rpc/bun';
import { testLiveQueries } from '#testing/live-queries';

test.stable(
  'native scoped HTTP RPC reaches Source SQLite transactions and closes its listener',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const handlers = SourcesRpcLive.pipe(Layer.provide(testLiveQueries)).pipe(
      Layer.provide(Sources.layer),
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );
    let url = '';

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const server = yield* serveRpc({ group: SourcesRpc, handlers });

            url = server.url;
            const client = yield* makeStudyClient(SourcesRpc, { baseUrl: url });
            const missing = Schema.decodeUnknownSync(sourceIdSchema)(9223372036854775807n);

            test.assert.ok(Option.isNone(yield* client['sources.findSource']({ id: missing })));
            const absent = yield* Effect.flip(client['sources.source']({ id: missing }));

            test.assert.ok('kind' in absent);
            test.assert.ok(absent.kind === 'not_found');
            const created = yield* client['sources.createSource']({
              name: 'notes.txt',
              bytes: new TextEncoder().encode('Study notes'),
              projectId: null
            });

            test.assert.ok(typeof created.id === 'bigint');
            test.assert.ok(created.sha256 instanceof Uint8Array);
            test.assert.strictEqual(created.sha256.length, 32);
            test.expect(yield* client['sources.source']({ id: created.id })).toStrictEqual(created);
            const state = yield* client['sources.sourceProcessing']({ id: created.id });
            const stale = yield* Effect.flip(
              client['sources.requestSourceProcessing']({
                id: created.id,
                expectedRevision: state.revision + 1
              })
            );

            test.assert.ok('kind' in stale);
            test.assert.ok(stale.kind === 'invalid_input');
            test.assert.strictEqual(context.db.orm.select().from(workflowEvents).all().length, 1);
            const renewed = yield* client['sources.requestSourceProcessing']({
              id: created.id,
              expectedRevision: state.revision
            });

            test.assert.notStrictEqual(renewed.requestId, state.requestId);
            test.assert.strictEqual(context.db.orm.select().from(workflowEvents).all().length, 2);
            const response = yield* Effect.promise(() =>
              fetch(`${url}/rpc`, {
                method: 'POST',
                headers: { origin: 'https://untrusted.example' }
              })
            );

            test.assert.strictEqual(response.status, 403);
          })
        )
      );

      await test.expect(fetch(`${url}/rpc`)).rejects.toSatisfy(() => true);
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
