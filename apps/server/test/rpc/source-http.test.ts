import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sourceIdSchema } from '@study/contracts/ids';
import { SourcesRpc } from '@study/contracts/sources/rpc';
import { workflowEvents } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer, Option, Schema } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { SourcesRpcLive } from '#server/features/sources/rpc/index';
import { Sources } from '#server/features/sources/service/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { serveRpc } from '#server/platform/rpc/node';

test('native scoped HTTP RPC reaches Source SQLite transactions and closes its listener', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const handlers = SourcesRpcLive.pipe(
    Layer.provide(Sources.layer),
    Layer.provide(Layer.succeed(Database, { store: context }))
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
          assert.equal(absent.kind, 'not_found');
          const created = yield* client['sources.createSource']({
            name: 'notes.txt',
            bytes: new TextEncoder().encode('Study notes'),
            projectId: null
          });

          assert.equal(typeof created.id, 'bigint');
          assert.ok(created.sha256 instanceof Uint8Array);
          assert.equal(created.sha256.length, 32);
          assert.deepEqual(yield* client['sources.source']({ id: created.id }), created);
          const state = yield* client['sources.sourceProcessing']({ id: created.id });
          const stale = yield* Effect.flip(
            client['sources.requestSourceProcessing']({
              id: created.id,
              expectedRevision: state.revision + 1
            })
          );

          assert.ok('kind' in stale);
          assert.equal(stale.kind, 'invalid_input');
          assert.equal(context.db.orm.select().from(workflowEvents).all().length, 1);
          const renewed = yield* client['sources.requestSourceProcessing']({
            id: created.id,
            expectedRevision: state.revision
          });

          assert.notEqual(renewed.requestId, state.requestId);
          assert.equal(context.db.orm.select().from(workflowEvents).all().length, 2);
          const response = yield* Effect.promise(() =>
            fetch(`${url}/rpc`, {
              method: 'POST',
              headers: { origin: 'https://untrusted.example' }
            })
          );

          assert.equal(response.status, 403);
        })
      )
    );

    await assert.rejects(fetch(`${url}/rpc`));
  } finally {
    context.close();
    location.cleanup();
  }
});
