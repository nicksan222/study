import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DocumentId, SourceId } from '@study/contracts/ids';
import { SourcesRpc } from '@study/contracts/sources/rpc';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer, Option } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Sources } from '#server/features/sources/service/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { SourcesRpcLive } from './index.ts';

test('RPC handlers use the source service and return canonical failures', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const handlers = SourcesRpcLive.pipe(
    Layer.provide(Sources.layer),
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(SourcesRpc, { flatten: true });
          const id = 9999n as SourceId;

          assert.equal((yield* Effect.flip(client('sources.source', { id }))).kind, 'not_found');
          assert.ok(Option.isNone(yield* client('sources.findSource', { id })));
          const link = yield* client('sources.addLink', {
            url: 'https://example.org/path',
            projectId: null
          });

          assert.equal(
            (yield* Effect.flip(
              client('sources.addLink', { url: 'file:///tmp/test', projectId: null })
            )).kind,
            'invalid_input'
          );
          const linkExport = yield* client('sources.sourceExport', { id: link.id });

          assert.equal(new TextDecoder().decode(linkExport.bytes), link.uri);
          assert.equal(linkExport.source.uri, link.uri);
          assert.equal(link.kind, 'link');
          assert.equal(link.uri, 'https://example.org/path');
          const created = yield* client('sources.createSource', {
            name: 'test.txt',
            bytes: new Uint8Array([1]),
            projectId: null
          });

          assert.equal((yield* client('sources.source', { id: created.id })).id, created.id);
          assert.deepEqual(
            (yield* client('sources.sourceExport', { id: created.id })).bytes,
            new Uint8Array([1])
          );
          assert.equal(
            (yield* Effect.flip(
              client('sources.correctBlock', {
                id: created.id,
                documentId: 1n as DocumentId,
                ordinal: 0,
                before: 'x',
                after: 'y'
              })
            )).kind,
            'invalid_input'
          );
          const replaced = yield* client('sources.replaceSource', {
            id: created.id,
            expectedRevision: 1,
            name: '  image.png  ',
            bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
          });

          assert.equal(replaced.revision, 2);
          assert.equal((yield* client('sources.source', { id: created.id })).mime, 'image/png');
          assert.equal(yield* client('sources.deleteSource', { id: created.id }), true);
          assert.equal(yield* client('sources.deleteSource', { id: created.id }), false);
        }).pipe(Effect.provide(handlers))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
