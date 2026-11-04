import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { DocumentsRpc } from '@study/contracts/documents/rpc';
import { createBlock } from '@study/contracts/sources/document';
import { SourcesRpc } from '@study/contracts/sources/rpc';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/node';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Documents } from '#server/features/documents/index';
import { DocumentsRpcLive } from '#server/features/documents/rpc/index';
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
      Layer.mergeAll(DocumentsRpcLive, SourcesRpcLive).pipe(
        Layer.provideMerge(Layer.mergeAll(Documents.layer, Sources.layer)),
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
            const rpc = yield* RpcTest.makeClient(DocumentsRpc.merge(SourcesRpc));
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
            assert.notEqual(source.id, other.id);
            assert.equal((yield* rpc['sources.source']({ id: source.id })).id, source.id);
            const imageBlock = createBlock({
              type: 'image',
              sourceId: source.id,
              revision: 1,
              alt: 'Retained'
            });
            const empty = createBlock({ type: 'paragraph', inlines: [] });
            const document = body([imageBlock, empty]);
            const authored = yield* rpc['documents.create']({
              createKey: randomUUID(),
              title: 'Reader',
              document,
              inputs: [],
              citations: []
            });
            assert.ok(authored.version);
            const original = yield* rpc['documents.version']({ id: authored.version.id });
            assert.deepEqual(original.document, document);
            const another = yield* rpc['documents.create']({
              createKey: randomUUID(),
              title: 'Other',
              document: body([createBlock({ type: 'paragraph', inlines: [] })]),
              inputs: [],
              citations: []
            });
            assert.ok(another.version);
            assert.notEqual(original.snapshotId, another.version.snapshotId);
            assert.notEqual(original.documentId, another.id);
            assert.ok(original.document.blocks[0]?.content.type === 'image');
            const image = yield* rpc['sources.exportRevision']({
              sourceId: original.document.blocks[0].content.sourceId,
              revision: BigInt(original.document.blocks[0].content.revision)
            });
            assert.equal(image.mime, 'image/png');
            assert.deepEqual(image.bytes, bytes);
            const revised = yield* rpc['documents.save']({
              documentId: authored.id,
              expectedVersionId: original.id,
              key: 'remove-image',
              document: body([empty])
            });
            const next = yield* rpc['documents.version']({ id: revised.submittedVersionId });
            assert.equal(
              next.document.blocks.some((block) => block.content.type === 'image'),
              false
            );
            assert.deepEqual(yield* rpc['documents.version']({ id: original.id }), original);
            assert.equal(f.context.db.orm.get(sql`SELECT count(*) n FROM materials`)?.n, 0n);
            return { original, image, source };
          }).pipe(Effect.provide(f.handlers()))
        )
      );
      f.reopen();
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(DocumentsRpc.merge(SourcesRpc));
            assert.deepEqual(
              yield* rpc['documents.version']({ id: saved.original.id }),
              saved.original
            );
            assert.deepEqual(
              yield* rpc['sources.exportRevision']({ sourceId: saved.source.id, revision: 1n }),
              saved.image
            );
            assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
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
            const rpc = yield* RpcTest.makeClient(DocumentsRpc.merge(SourcesRpc));
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
            const authored = yield* rpc['documents.create']({
              createKey: randomUUID(),
              title: 'History reader',
              document,
              inputs: [],
              citations: []
            });
            assert.ok(authored.version);
            const next = yield* rpc['documents.save']({
              documentId: authored.id,
              expectedVersionId: authored.version.id,
              key: 'next',
              document
            });
            const before = yield* rpc['documents.version']({ id: authored.version.id });
            const after = yield* rpc['documents.version']({ id: next.submittedVersionId });
            const preview = yield* rpc['documents.previewHistory']({
              documentId: authored.id,
              keepLatest: 1
            });
            yield* rpc['documents.retireHistory']({
              documentId: authored.id,
              keepLatest: 1,
              token: preview.token
            });
            assert.equal(
              (yield* Effect.flip(rpc['documents.version']({ id: before.id }))).kind,
              'not_found'
            );
            assert.equal(
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
            const rpc = yield* RpcTest.makeClient(DocumentsRpc.merge(SourcesRpc));
            assert.equal(
              (yield* Effect.flip(rpc['documents.version']({ id: saved.before.id }))).kind,
              'not_found'
            );
            assert.deepEqual(yield* rpc['documents.version']({ id: saved.after.id }), saved.after);
            const image = yield* rpc['sources.exportRevision']({
              sourceId: saved.source.id,
              revision: 1n
            });
            assert.equal(image.mime, 'image/png');
            assert.ok(image.bytes.length);
            assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
          }).pipe(Effect.provide(f.handlers()))
        )
      );
    } finally {
      f.close();
    }
  }
);
