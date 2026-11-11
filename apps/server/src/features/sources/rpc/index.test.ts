/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises source RPC operations and typed error behavior against an isolated       │
 * │ database-backed service.                                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises RPC handlers use the source service and return canonical failures.           │
 * │ - Checks focused behavior using the file’s test fixtures.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Builds feature behavior through its service, store, RPC, or workflow test layer;         │
 * │ fixtures stay local to these tests.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { ContentSnapshotId, SourceId } from '@study/contracts/ids';
import { SourcesRpc } from '@study/contracts/sources/rpc';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Option } from 'effect';
import { RpcTest } from 'effect/rpc';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Sources } from '#server/features/sources/service/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { SourcesRpcLive } from './index.ts';

testStable('RPC handlers use the source service and return canonical failures', async () => {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
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

          assert.ok((yield* Effect.flip(client('sources.source', { id }))).kind === 'not_found');
          assert.ok(Option.isNone(yield* client('sources.findSource', { id })));
          const link = yield* client('sources.addLink', {
            url: 'https://example.org/path',
            projectId: null
          });

          assert.ok(
            (yield* Effect.flip(
              client('sources.addLink', { url: 'file:///tmp/test', projectId: null })
            )).kind === 'invalid_input'
          );
          const linkExport = yield* client('sources.sourceExport', { id: link.id });

          assert.strictEqual(new TextDecoder().decode(linkExport.bytes), link.uri);
          assert.strictEqual(linkExport.source.uri, link.uri);
          assert.ok(link.kind === 'link');
          assert.ok(link.uri === 'https://example.org/path');
          const created = yield* client('sources.createSource', {
            name: 'test.txt',
            bytes: new Uint8Array([1]),
            projectId: null
          });

          assert.strictEqual((yield* client('sources.source', { id: created.id })).id, created.id);
          expect((yield* client('sources.sourceExport', { id: created.id })).bytes).toStrictEqual(
            new Uint8Array([1])
          );
          assert.ok(
            (yield* Effect.flip(
              client('sources.correctBlock', {
                id: created.id,
                documentId: 1n as ContentSnapshotId,
                ordinal: 0,
                before: 'x',
                after: 'y'
              })
            )).kind === 'invalid_input'
          );
          const replaced = yield* client('sources.replaceSource', {
            id: created.id,
            expectedRevision: 1,
            name: '  image.png  ',
            bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
          });

          assert.strictEqual(replaced.revision, 2);
          assert.ok((yield* client('sources.source', { id: created.id })).mime === 'image/png');
          assert.strictEqual(yield* client('sources.deleteSource', { id: created.id }), true);
          assert.ok(Option.isNone(yield* client('sources.findSource', { id: created.id })));
          assert.strictEqual(yield* client('sources.deleteSource', { id: created.id }), false);
          assert.strictEqual(yield* client('sources.deleteSource', { id }), false);
        }).pipe(Effect.provide(handlers))
      )
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});
