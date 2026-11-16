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
import { ServerContext } from '@study/server';
import { Database } from '@study/server';
import { serveRpc } from '@study/server';
import { test } from '@study/testing';
import { Effect, Layer, Option, Schema } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { SourcesRpcLive } from '#server/features/sources/rpc/index';
import { Sources } from '#server/features/sources/service/index';
import { testLiveQueries } from '#testing/live-queries';

test.server.stable(
  'native scoped HTTP RPC reaches Source SQLite transactions and closes its listener',
  async ({ databases, assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

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

            assert.ok(Option.isNone(yield* client['sources.findSource']({ id: missing })));
            const absent = yield* Effect.flip(client['sources.source']({ id: missing }));

            assert.ok('kind' in absent);
            assert.ok(absent.kind === 'not_found');
            const created = yield* client['sources.createSource']({
              name: 'notes.txt',
              bytes: new TextEncoder().encode('Study notes'),
              projectId: null
            });

            assert.ok(typeof created.id === 'bigint');
            assert.ok(created.sha256 instanceof Uint8Array);
            assert.strictEqual(created.sha256.length, 32);
            expect(yield* client['sources.source']({ id: created.id })).toStrictEqual(created);
            const state = yield* client['sources.sourceProcessing']({ id: created.id });
            const stale = yield* Effect.flip(
              client['sources.requestSourceProcessing']({
                id: created.id,
                expectedRevision: state.revision + 1
              })
            );

            assert.ok('kind' in stale);
            assert.ok(stale.kind === 'invalid_input');
            assert.strictEqual(context.db.orm.select().from(workflowEvents).all().length, 1);
            const renewed = yield* client['sources.requestSourceProcessing']({
              id: created.id,
              expectedRevision: state.revision
            });

            assert.notStrictEqual(renewed.requestId, state.requestId);
            assert.strictEqual(context.db.orm.select().from(workflowEvents).all().length, 2);
            const response = yield* Effect.promise(() =>
              fetch(`${url}/rpc`, {
                method: 'POST',
                headers: { origin: 'https://untrusted.example' }
              })
            );

            assert.strictEqual(response.status, 403);
          })
        )
      );

      await expect(fetch(`${url}/rpc`)).rejects.toSatisfy(() => true);
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
