/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises authored Page reader behavior through real persistence boundaries.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies exact authored readers and source-owned image revisions retain independent    │
 * │   identities across reopen.                                                              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import { PagesRpc } from '@study/contracts/pages/rpc';
import { createBlock } from '@study/contracts/sources/document';
import { SourcesRpc } from '@study/contracts/sources/rpc';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Pages } from '#server/features/pages/index';
import { PagesRpcLive } from '#server/features/pages/rpc/index';
import { Sources } from '#server/features/sources/index';
import { SourcesRpcLive } from '#server/features/sources/rpc/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

const body = (blocks: ReturnType<typeof createBlock>[]) => ({
  blocks,
  meta: {
    extractor: null,
    extractorVersion: 1,
    provider: null,
    durationMs: null,
    pageCount: null,
    refiners: [],
    waitingFor: [],
    corrected: false,
    omissions: []
  }
});

function fixture() {
  const location = createTestDatabase();
  let context = new ServerContext(location.open());

  return {
    get context() {
      return context;
    },
    handlers: () =>
      Layer.mergeAll(PagesRpcLive, SourcesRpcLive).pipe(
        Layer.provideMerge(Layer.mergeAll(Pages.layer, Sources.layer)),
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      ),
    reopen() {
      context.close();
      context = new ServerContext(location.open());
    },
    close() {
      context.close();
      location.cleanup();
    }
  };
}

testStable(
  'exact authored readers and source-owned image revisions retain independent identities across reopen',
  async () => {
    const f = fixture();

    try {
      const saved = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(PagesRpc.merge(SourcesRpc));
            const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
            const source = yield* rpc['sources.createSource']({
              projectId: null,
              name: 'retained.png',
              bytes
            });
            const other = yield* rpc['sources.createSource']({
              projectId: null,
              name: 'retained.png',
              bytes: new Uint8Array([...bytes, 1])
            });

            assert.notStrictEqual(source.id, other.id);
            assert.strictEqual((yield* rpc['sources.source']({ id: source.id })).id, source.id);
            const imageBlock = createBlock({
              type: 'image',
              sourceId: source.id,
              revision: 1,
              alt: 'Retained'
            });
            const empty = createBlock({ type: 'paragraph', inlines: [] });
            const document = body([imageBlock, empty]);
            const authored = yield* rpc['pages.create']({
              createKey: randomUUID(),
              title: 'Reader',
              document,
              inputs: [],
              citations: []
            });

            assert.ok(authored.version);
            const original = yield* rpc['pages.version']({ id: authored.version.id });

            expect(original.document).toStrictEqual(document);
            const another = yield* rpc['pages.create']({
              createKey: randomUUID(),
              title: 'Other',
              document: body([createBlock({ type: 'paragraph', inlines: [] })]),
              inputs: [],
              citations: []
            });

            assert.ok(another.version);
            assert.notStrictEqual(original.snapshotId, another.version.snapshotId);
            assert.notStrictEqual(original.pageId, another.id);
            assert.ok(original.document.blocks[0]?.content.type === 'image');
            const image = yield* rpc['sources.exportRevision']({
              sourceId: original.document.blocks[0].content.sourceId,
              revision: BigInt(original.document.blocks[0].content.revision)
            });

            assert.ok(image.mime === 'image/png');
            expect(image.bytes).toStrictEqual(bytes);
            const revised = yield* rpc['pages.save']({
              pageId: authored.id,
              expectedVersionId: original.id,
              key: 'remove-image',
              document: body([empty])
            });
            const next = yield* rpc['pages.version']({ id: revised.submittedVersionId });

            assert.ok(
              next.document.blocks.some((block) => block.content.type === 'image') === false
            );
            expect(yield* rpc['pages.version']({ id: original.id })).toStrictEqual(original);
            assert.strictEqual(f.context.db.orm.get(sql`SELECT count(*) n FROM materials`)?.n, 0n);

            return { original, image, source };
          }).pipe(Effect.provide(f.handlers()))
        )
      );

      f.reopen();
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(PagesRpc.merge(SourcesRpc));

            expect(yield* rpc['pages.version']({ id: saved.original.id })).toStrictEqual(
              saved.original
            );
            expect(
              yield* rpc['sources.exportRevision']({ sourceId: saved.source.id, revision: 1n })
            ).toStrictEqual(saved.image);
            expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
          }).pipe(Effect.provide(f.handlers()))
        )
      );
    } finally {
      f.close();
    }
  }
);

testStable(
  'authored history retirement removes its exact reader body while an independent version retains image bytes',
  async () => {
    const f = fixture();

    try {
      const saved = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(PagesRpc.merge(SourcesRpc));
            const source = yield* rpc['sources.createSource']({
              projectId: null,
              name: 'history.png',
              bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
            });
            const block = createBlock({
              type: 'image',
              sourceId: source.id,
              revision: 1,
              alt: 'History'
            });
            const document = body([block]);
            const authored = yield* rpc['pages.create']({
              createKey: randomUUID(),
              title: 'History reader',
              document,
              inputs: [],
              citations: []
            });

            assert.ok(authored.version);
            const next = yield* rpc['pages.save']({
              pageId: authored.id,
              expectedVersionId: authored.version.id,
              key: 'next',
              document
            });
            const before = yield* rpc['pages.version']({ id: authored.version.id });
            const after = yield* rpc['pages.version']({ id: next.submittedVersionId });
            const preview = yield* rpc['pages.previewHistory']({
              pageId: authored.id,
              keepLatest: 1
            });

            yield* rpc['pages.retireHistory']({
              pageId: authored.id,
              keepLatest: 1,
              token: preview.token
            });
            assert.ok(
              (yield* Effect.flip(rpc['pages.version']({ id: before.id }))).kind === 'not_found'
            );
            assert.strictEqual(
              f.context.db.orm.get(
                sql`SELECT 1 FROM document_assets WHERE document_id=${before.snapshotId}`
              ),
              undefined
            );
            assert.ok(
              f.context.db.orm.get(
                sql`SELECT 1 FROM document_assets WHERE document_id=${after.snapshotId}`
              )
            );

            return { before, after, source };
          }).pipe(Effect.provide(f.handlers()))
        )
      );

      f.reopen();
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(PagesRpc.merge(SourcesRpc));

            assert.ok(
              (yield* Effect.flip(rpc['pages.version']({ id: saved.before.id }))).kind ===
                'not_found'
            );
            expect(yield* rpc['pages.version']({ id: saved.after.id })).toStrictEqual(saved.after);
            const image = yield* rpc['sources.exportRevision']({
              sourceId: saved.source.id,
              revision: 1n
            });

            assert.ok(image.mime === 'image/png');
            assert.ok(image.bytes.length);
            expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
          }).pipe(Effect.provide(f.handlers()))
        )
      );
    } finally {
      f.close();
    }
  }
);
