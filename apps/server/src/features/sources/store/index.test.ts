/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks source store persistence, revision history, processing state, and snapshot  │
 * │ consistency in SQLite.                                                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises snapshots survive replacement and stale publications leave no document.      │
 * │ - Checks focused behavior using the file’s test fixtures.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Builds feature behavior through its service, store, RPC, or workflow test layer;         │
 * │ fixtures stay local to these tests.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { plainBlock } from '@study/contracts/sources/document';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Option } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction, useStore } from '#server/platform/definitions/define-store';

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
  blocks: [plainBlock('paragraph' as const, 'hello', { type: 'page' as const, page: 1 })],
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
};

testStable('snapshots survive replacement and stale publications leave no document', async () => {
  const location = await createTestDatabase();
  let context = new ServerContext(await location.open());

  try {
    const source = await Effect.runPromise(
      transaction((tx) => tx.store(SourceStore).createSource(input)).pipe(
        Effect.provideService(Database, { store: context })
      )
    );

    assert.strictEqual(source.sizeBytes, 5n);
    assert.ok(
      Buffer.from(source.sha256).toString('hex') ===
        'a7937b64b8caa58f03721bb6bacf5c78cb235febe0e70b1b84cd99541461a08e'
    );
    await Effect.runPromise(
      transaction((tx) =>
        tx.store(SourceStore).replaceSourceInput({
          id: source.id,
          expectedRevision: 1,
          bytes: new TextEncoder().encode('second'),
          kind: 'pdf',
          mime: 'application/pdf',
          uri: 'https://example.com/replacement',
          requestId: 'request-2'
        })
      ).pipe(Effect.provideService(Database, { store: context }))
    );
    await expect(
      Effect.runPromise(
        transaction((tx) =>
          tx.store(SourceStore).replaceSourceInput({
            id: source.id,
            expectedRevision: 1,
            bytes: new TextEncoder().encode('bad'),
            requestId: 'stale'
          })
        ).pipe(Effect.provideService(Database, { store: context }))
      )
    ).rejects.toSatisfy(() => true);
    const updated = await Effect.runPromise(
      Effect.runSync(
        useStore(SourceStore).pipe(Effect.provideService(Database, { store: context }))
      ).source(source.id)
    );

    assert.strictEqual(updated.sizeBytes, 6n);
    assert.ok(
      Buffer.from(updated.sha256).toString('hex') ===
        '16367aacb67a4a017c8da8ab95682ccb390863780f7114dda0a0e0c55644c7c4'
    );
    const old = await Effect.runPromise(
      Effect.runSync(
        useStore(SourceSnapshotStore).pipe(Effect.provideService(Database, { store: context }))
      ).sourceSnapshot({ id: source.id, revision: 1 })
    );

    assert.ok(new TextDecoder().decode(old.bytes) === 'first');
    assert.ok(old.kind === 'text');
    assert.ok(old.mime === 'text/plain');
    assert.ok(old.uri === 'https://example.com/original');
    await expect(
      Effect.runPromise(
        transaction((tx) =>
          tx.store(SourceStore).publishSourceDocument({
            id: source.id,
            expectedRevision: 1,
            requestId: 'request-1',
            document
          })
        ).pipe(Effect.provideService(Database, { store: context }))
      )
    ).rejects.toSatisfy(() => true);
    await expect(
      Effect.runPromise(
        transaction((tx) =>
          tx.store(SourceStore).publishSourceDocument({
            id: source.id,
            expectedRevision: 2,
            requestId: 'request-1',
            document
          })
        ).pipe(Effect.provideService(Database, { store: context }))
      )
    ).rejects.toSatisfy(() => true);
    assert.ok(
      (
        await Effect.runPromise(
          Effect.runSync(
            useStore(SourceProcessingStore).pipe(
              Effect.provideService(Database, { store: context })
            )
          ).sourceProcessing(source.id)
        )
      ).documentId === null
    );
    assert.strictEqual(
      context.db.orm.get<{ count: bigint }>(sql`SELECT count(*) AS count FROM content_snapshots`)
        ?.count,
      0n
    );
    await Effect.runPromise(
      transaction((tx) =>
        tx
          .store(SourceStore)
          .requestSourceProcessing({ id: source.id, expectedRevision: 2, requestId: 'request-3' })
      ).pipe(Effect.provideService(Database, { store: context }))
    );
    await expect(
      Effect.runPromise(
        transaction((tx) =>
          tx.store(SourceStore).publishSourceDocument({
            id: source.id,
            expectedRevision: 2,
            requestId: 'request-2',
            document
          })
        ).pipe(Effect.provideService(Database, { store: context }))
      )
    ).rejects.toSatisfy(() => true);
    await expect(
      Effect.runPromise(
        transaction((tx) => {
          tx.store(SourceStore).publishSourceDocument({
            id: source.id,
            expectedRevision: 2,
            requestId: 'request-3',
            document
          });

          throw new Error('rollback');
        }).pipe(Effect.provideService(Database, { store: context }))
      )
    ).rejects.toSatisfy(() => true);
    assert.strictEqual(
      context.db.orm.get<{ count: bigint }>(sql`SELECT count(*) AS count FROM content_snapshots`)
        ?.count,
      0n
    );
    assert.ok(
      (
        await Effect.runPromise(
          Effect.runSync(
            useStore(SourceProcessingStore).pipe(
              Effect.provideService(Database, { store: context })
            )
          ).sourceProcessing(source.id)
        )
      ).documentId === null
    );
    const { documentId: id } = await Effect.runPromise(
      transaction((tx) =>
        tx.store(SourceStore).publishSourceDocument({
          id: source.id,
          expectedRevision: 2,
          requestId: 'request-3',
          document
        })
      ).pipe(Effect.provideService(Database, { store: context }))
    );

    assert.strictEqual(
      context.db.orm.get<{ count: bigint }>(sql`SELECT count(*) AS count FROM blocks`)?.count,
      1n
    );
    await Effect.runPromise(
      transaction((tx) =>
        tx
          .store(SourceStore)
          .requestSourceProcessing({ id: source.id, expectedRevision: 2, requestId: 'request-4' })
      ).pipe(Effect.provideService(Database, { store: context }))
    );
    await expect(
      Effect.runPromise(
        transaction((tx) =>
          tx.store(SourceStore).publishSourceDocument({
            id: source.id,
            expectedRevision: 2,
            requestId: 'request-4',
            document: { ...document, meta: { ...document.meta, extractor: 'nonexistent' } }
          })
        ).pipe(Effect.provideService(Database, { store: context }))
      )
    ).rejects.toSatisfy(() => true);
    assert.strictEqual(
      context.db.orm.get<{ count: bigint }>(sql`SELECT count(*) AS count FROM content_snapshots`)
        ?.count,
      1n
    );
    assert.strictEqual(
      (
        await Effect.runPromise(
          Effect.runSync(
            useStore(SourceProcessingStore).pipe(
              Effect.provideService(Database, { store: context })
            )
          ).sourceProcessing(source.id)
        )
      ).documentId,
      id
    );
    context.close();
    context = new ServerContext(await location.open());
    assert.strictEqual(
      (
        await Effect.runPromise(
          Effect.runSync(
            useStore(SourceProcessingStore).pipe(
              Effect.provideService(Database, { store: context })
            )
          ).sourceProcessing(source.id)
        )
      ).documentId,
      id
    );
    assert.ok(
      new TextDecoder().decode(
        (
          await Effect.runPromise(
            Effect.runSync(
              useStore(SourceSnapshotStore).pipe(
                Effect.provideService(Database, { store: context })
              )
            ).sourceSnapshot({ id: source.id, revision: 1 })
          )
        ).bytes
      ) === 'first'
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});

testStable('source reads distinguish absence and enforce bounded pagination', async () => {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());

  try {
    const a = await Effect.runPromise(
      transaction((tx) => tx.store(SourceStore).createSource(input)).pipe(
        Effect.provideService(Database, { store: context })
      )
    );
    const b = await Effect.runPromise(
      transaction((tx) => tx.store(SourceStore).createSource(input)).pipe(
        Effect.provideService(Database, { store: context })
      )
    );

    expect(
      (
        await Effect.runPromise(
          Effect.runSync(
            useStore(SourceStore).pipe(Effect.provideService(Database, { store: context }))
          ).sources({ limit: 1 })
        )
      ).map((s) => s.id)
    ).toStrictEqual([b.id]);
    expect(
      (
        await Effect.runPromise(
          Effect.runSync(
            useStore(SourceStore).pipe(Effect.provideService(Database, { store: context }))
          ).sources({ limit: 1, before: b.id })
        )
      ).map((s) => s.id)
    ).toStrictEqual([a.id]);
    assert.ok(
      Option.isNone(
        await Effect.runPromise(
          Effect.runSync(
            useStore(SourceStore).pipe(Effect.provideService(Database, { store: context }))
          ).findSource(999n as typeof a.id)
        )
      )
    );
    await expect(
      Effect.runPromise(
        Effect.runSync(
          useStore(SourceStore).pipe(Effect.provideService(Database, { store: context }))
        ).source(999n as typeof a.id)
      )
    ).rejects.toSatisfy(() => true);
    await expect(
      Effect.runPromise(
        Effect.runSync(
          useStore(SourceStore).pipe(Effect.provideService(Database, { store: context }))
        ).sources({ limit: 0 })
      )
    ).rejects.toSatisfy(() => true);
  } finally {
    context.close();
    await location.cleanup();
  }
});
