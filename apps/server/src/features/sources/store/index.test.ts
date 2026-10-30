import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Option } from 'effect';

import { ServerContext } from '#server/platform/database/context';
import { transaction } from '#server/platform/definitions/define-store';

import { SourceStore, SourceProcessingStore, SourceSnapshotStore } from './index.ts';

const input = {
  name: 'test.txt',
  kind: 'text' as const,
  mime: 'text/plain',
  origin: 'import' as const,
  projectId: null,
  uri: 'https://example.com/original',
  bytes: new TextEncoder().encode('first'),
  requestId: 'request-1'
};

const document = {
  blocks: [
    { kind: 'paragraph' as const, text: 'hello', anchor: { type: 'page' as const, page: 1 } }
  ],
  meta: {
    extractor: null,
    extractorVersion: 1,
    provider: null,
    durationMs: null,
    pageCount: null,
    refiners: [],
    waitingFor: [],
    corrected: false
  }
};

test('snapshots survive replacement and stale publications leave no document', async () => {
  const location = createTestDatabase();
  let context = new ServerContext(location.open());

  try {
    const source = await Effect.runPromise(
      transaction(context, (tx) => tx.store(SourceStore).createSource(input))
    );

    assert.equal(source.sizeBytes, 5n);
    assert.equal(
      Buffer.from(source.sha256).toString('hex'),
      'a7937b64b8caa58f03721bb6bacf5c78cb235febe0e70b1b84cd99541461a08e'
    );
    await Effect.runPromise(
      transaction(context, (tx) =>
        tx.store(SourceStore).replaceSourceInput({
          id: source.id,
          expectedRevision: 1,
          bytes: new TextEncoder().encode('second'),
          kind: 'pdf',
          mime: 'application/pdf',
          uri: 'https://example.com/replacement',
          requestId: 'request-2'
        })
      )
    );
    await assert.rejects(
      Effect.runPromise(
        transaction(context, (tx) =>
          tx.store(SourceStore).replaceSourceInput({
            id: source.id,
            expectedRevision: 1,
            bytes: new TextEncoder().encode('bad'),
            requestId: 'stale'
          })
        )
      )
    );
    const updated = await Effect.runPromise(SourceStore.make(context).source(source.id));

    assert.equal(updated.sizeBytes, 6n);
    assert.equal(
      Buffer.from(updated.sha256).toString('hex'),
      '16367aacb67a4a017c8da8ab95682ccb390863780f7114dda0a0e0c55644c7c4'
    );
    const old = await Effect.runPromise(
      SourceSnapshotStore.make(context).sourceSnapshot({ id: source.id, revision: 1 })
    );

    assert.equal(new TextDecoder().decode(old.bytes), 'first');
    assert.equal(old.kind, 'text');
    assert.equal(old.mime, 'text/plain');
    assert.equal(old.uri, 'https://example.com/original');
    await assert.rejects(
      Effect.runPromise(
        transaction(context, (tx) =>
          tx.store(SourceStore).publishSourceDocument({
            id: source.id,
            expectedRevision: 1,
            requestId: 'request-1',
            document
          })
        )
      )
    );
    await assert.rejects(
      Effect.runPromise(
        transaction(context, (tx) =>
          tx.store(SourceStore).publishSourceDocument({
            id: source.id,
            expectedRevision: 2,
            requestId: 'request-1',
            document
          })
        )
      )
    );
    assert.equal(
      (await Effect.runPromise(SourceProcessingStore.make(context).sourceProcessing(source.id)))
        .documentId,
      null
    );
    assert.equal(
      context.db.orm.get<{ count: bigint }>(sql`SELECT count(*) AS count FROM documents`)?.count,
      0n
    );
    await Effect.runPromise(
      transaction(context, (tx) =>
        tx
          .store(SourceStore)
          .requestSourceProcessing({ id: source.id, expectedRevision: 2, requestId: 'request-3' })
      )
    );
    await assert.rejects(
      Effect.runPromise(
        transaction(context, (tx) =>
          tx.store(SourceStore).publishSourceDocument({
            id: source.id,
            expectedRevision: 2,
            requestId: 'request-2',
            document
          })
        )
      )
    );
    await assert.rejects(
      Effect.runPromise(
        transaction(context, (tx) => {
          tx.store(SourceStore).publishSourceDocument({
            id: source.id,
            expectedRevision: 2,
            requestId: 'request-3',
            document
          });

          throw new Error('rollback');
        })
      )
    );
    assert.equal(
      context.db.orm.get<{ count: bigint }>(sql`SELECT count(*) AS count FROM documents`)?.count,
      0n
    );
    assert.equal(
      (await Effect.runPromise(SourceProcessingStore.make(context).sourceProcessing(source.id)))
        .documentId,
      null
    );
    const { documentId: id } = await Effect.runPromise(
      transaction(context, (tx) =>
        tx.store(SourceStore).publishSourceDocument({
          id: source.id,
          expectedRevision: 2,
          requestId: 'request-3',
          document
        })
      )
    );

    assert.equal(
      context.db.orm.get<{ count: bigint }>(sql`SELECT count(*) AS count FROM blocks`)?.count,
      1n
    );
    await Effect.runPromise(
      transaction(context, (tx) =>
        tx
          .store(SourceStore)
          .requestSourceProcessing({ id: source.id, expectedRevision: 2, requestId: 'request-4' })
      )
    );
    await assert.rejects(
      Effect.runPromise(
        transaction(context, (tx) =>
          tx.store(SourceStore).publishSourceDocument({
            id: source.id,
            expectedRevision: 2,
            requestId: 'request-4',
            document: { ...document, meta: { ...document.meta, extractor: 'nonexistent' } }
          })
        )
      )
    );
    assert.equal(
      context.db.orm.get<{ count: bigint }>(sql`SELECT count(*) AS count FROM documents`)?.count,
      1n
    );
    assert.equal(
      (await Effect.runPromise(SourceProcessingStore.make(context).sourceProcessing(source.id)))
        .documentId,
      id
    );
    context.close();
    context = new ServerContext(location.open());
    assert.equal(
      (await Effect.runPromise(SourceProcessingStore.make(context).sourceProcessing(source.id)))
        .documentId,
      id
    );
    assert.equal(
      new TextDecoder().decode(
        (
          await Effect.runPromise(
            SourceSnapshotStore.make(context).sourceSnapshot({ id: source.id, revision: 1 })
          )
        ).bytes
      ),
      'first'
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('source reads distinguish absence and enforce bounded pagination', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());

  try {
    const a = await Effect.runPromise(
      transaction(context, (tx) => tx.store(SourceStore).createSource(input))
    );
    const b = await Effect.runPromise(
      transaction(context, (tx) => tx.store(SourceStore).createSource(input))
    );

    assert.deepEqual(
      (await Effect.runPromise(SourceStore.make(context).sources({ limit: 1 }))).map((s) => s.id),
      [b.id]
    );
    assert.deepEqual(
      (await Effect.runPromise(SourceStore.make(context).sources({ limit: 1, before: b.id }))).map(
        (s) => s.id
      ),
      [a.id]
    );
    assert.ok(
      Option.isNone(
        await Effect.runPromise(SourceStore.make(context).findSource(999n as typeof a.id))
      )
    );
    await assert.rejects(Effect.runPromise(SourceStore.make(context).source(999n as typeof a.id)));
    await assert.rejects(Effect.runPromise(SourceStore.make(context).sources({ limit: 0 })));
  } finally {
    context.close();
    location.cleanup();
  }
});
