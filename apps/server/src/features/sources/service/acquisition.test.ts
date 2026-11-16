import { SourcesRpc } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises source acquisition behavior through real persistence boundaries.         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies acquisition atomically retains independent originals without authoring        │
 * │   documents or source Materials.                                                         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { sql } from '@study/db';
import { test } from '@study/testing';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Sources } from '#server/features/sources/index';
import { SourcesRpcLive } from '#server/features/sources/rpc/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { testLiveQueries } from '#testing/live-queries';

test.stable(
  'acquisition atomically retains independent originals without authoring documents or source Materials',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const domain = SourcesRpcLive.pipe(Layer.provide(testLiveQueries)).pipe(
      Layer.provideMerge(Sources.layer),
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(SourcesRpc);
            const sources = yield* Sources;
            const bytes = new TextEncoder().encode('Independent identical bytes');
            const first = yield* rpc['sources.createSource']({
              name: 'same.txt',
              bytes,
              projectId: null
            });
            const second = yield* rpc['sources.createSource']({
              name: 'same.txt',
              bytes,
              projectId: null
            });

            test.assert.notStrictEqual(first.id, second.id);
            test.assert.strictEqual((yield* rpc['sources.sources']({ limit: 10 })).items.length, 2);

            for (const source of [first, second]) {
              test
                .expect(
                  (yield* sources.exportRevision({ sourceId: source.id, revision: 1n })).bytes
                )
                .toStrictEqual(bytes);
              test.assert.ok((yield* sources.sourceProcessing(source.id)).requestId);
              test.assert.strictEqual(yield* sources.currentExtraction({ id: source.id }), null);
            }

            test.assert.strictEqual(
              context.db.orm.get(sql`SELECT count(*) n FROM materials`)?.n,
              0n
            );
            test.assert.strictEqual(context.db.orm.get(sql`SELECT count(*) n FROM pages`)?.n, 0n);
            context.db.exec(
              "CREATE TRIGGER reject_acquisition BEFORE INSERT ON workflow_events WHEN NEW.type='SourceProcessingRequested' BEGIN SELECT RAISE(ABORT,'injected acquisition failure'); END"
            );
            yield* Effect.flip(
              rpc['sources.createSource']({ name: 'rollback.txt', bytes, projectId: null })
            );
            test.assert.strictEqual(context.db.orm.get(sql`SELECT count(*) n FROM sources`)?.n, 2n);
            test.assert.strictEqual(
              context.db.orm.get(sql`SELECT count(*) n FROM source_snapshots`)?.n,
              2n
            );
            test.assert.strictEqual((yield* sources.source(first.id)).id, first.id);
          })
        ).pipe(Effect.provide(domain))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

const originalFixtures = {
  image: { name: 'image.png', bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]) },
  audio: { name: 'audio.wav', bytes: new TextEncoder().encode('RIFF0000WAVE') },
  video: {
    name: 'video.mp4',
    bytes: new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109])
  }
};

for (const kind of ['image', 'audio', 'video', 'link'] as const)
  test.stable(
    `replacement from ${kind} retains original revision exports with independent source identity`,
    async ({ databases }) => {
      const location = await databases();
      const context = new ServerContext(await location.open());
      const domain = SourcesRpcLive.pipe(Layer.provide(testLiveQueries)).pipe(
        Layer.provideMerge(Sources.layer),
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );

      try {
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const rpc = yield* RpcTest.makeClient(SourcesRpc);
              const sources = yield* Sources;
              const source =
                kind === 'link'
                  ? yield* rpc['sources.addLink']({
                      projectId: null,
                      url: 'https://example.com/original'
                    })
                  : yield* rpc['sources.createSource']({
                      projectId: null,
                      ...originalFixtures[kind]
                    });
              const original = yield* sources.sourceSnapshot({ id: source.id, revision: 1 });

              test.assert.strictEqual(original.kind, kind);
              const bytes = new TextEncoder().encode('Replacement text');

              yield* rpc['sources.replaceSource']({
                id: source.id,
                expectedRevision: 1,
                name: 'replacement.txt',
                bytes
              });
              test.assert.strictEqual((yield* sources.source(source.id)).id, source.id);
              test.assert.strictEqual((yield* sources.sources({ limit: 10 })).items.length, 1);
              const replacement = yield* sources.sourceSnapshot({ id: source.id, revision: 2 });

              test.assert.ok(replacement.kind === 'text');
              test.assert.ok(replacement.mime === 'text/plain');
              test.expect(replacement.bytes).toStrictEqual(bytes);
              test
                .expect(yield* sources.sourceSnapshot({ id: source.id, revision: 1 }))
                .toStrictEqual(original);
              test
                .expect(
                  (yield* sources.exportRevision({ sourceId: source.id, revision: 1n })).bytes
                )
                .toStrictEqual(original.bytes);
              test
                .expect(
                  (yield* sources.exportRevision({ sourceId: source.id, revision: 2n })).bytes
                )
                .toStrictEqual(bytes);
              test.assert.strictEqual(
                (yield* sources.exportRevision({ sourceId: source.id, revision: 1n })).name,
                `source-${source.id}-revision-1`
              );
              test.assert.ok(
                (yield* sources.exportRevision({ sourceId: source.id, revision: 2n })).name ===
                  'replacement.txt'
              );
              test.assert.strictEqual(
                context.db.orm.get(sql`SELECT count(*) n FROM materials`)?.n,
                0n
              );
              test.assert.strictEqual(context.db.orm.get(sql`SELECT count(*) n FROM pages`)?.n, 0n);
              test.expect(context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
            })
          ).pipe(Effect.provide(domain))
        );
      } finally {
        context.close();
        await location.cleanup();
      }
    }
  );
