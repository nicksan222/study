import { plainBlock } from '@study/contracts';
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
import { sql } from '@study/db';
import { test } from '@study/testing';
import { Effect, Option } from 'effect';

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

test.stable(
  'snapshots survive replacement and stale publications leave no document',
  async ({ databases }) => {
    const location = await databases();
    let context = new ServerContext(await location.open());

    try {
      const source = await Effect.runPromise(
        transaction((tx) => tx.store(SourceStore).createSource(input)).pipe(
          Effect.provideService(Database, { store: context })
        )
      );

      test.assert.strictEqual(source.sizeBytes, 5n);
      test.assert.ok(
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
      await test
        .expect(
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
        )
        .rejects.toSatisfy(() => true);
      const updated = await Effect.runPromise(
        Effect.runSync(
          useStore(SourceStore).pipe(Effect.provideService(Database, { store: context }))
        ).source(source.id)
      );

      test.assert.strictEqual(updated.sizeBytes, 6n);
      test.assert.ok(
        Buffer.from(updated.sha256).toString('hex') ===
          '16367aacb67a4a017c8da8ab95682ccb390863780f7114dda0a0e0c55644c7c4'
      );
      const old = await Effect.runPromise(
        Effect.runSync(
          useStore(SourceSnapshotStore).pipe(Effect.provideService(Database, { store: context }))
        ).sourceSnapshot({ id: source.id, revision: 1 })
      );

      test.assert.ok(new TextDecoder().decode(old.bytes) === 'first');
      test.assert.ok(old.kind === 'text');
      test.assert.ok(old.mime === 'text/plain');
      test.assert.ok(old.uri === 'https://example.com/original');
      await test
        .expect(
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
        )
        .rejects.toSatisfy(() => true);
      await test
        .expect(
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
        )
        .rejects.toSatisfy(() => true);
      test.assert.ok(
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
      test.assert.strictEqual(
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
      await test
        .expect(
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
        )
        .rejects.toSatisfy(() => true);
      await test
        .expect(
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
        )
        .rejects.toSatisfy(() => true);
      test.assert.strictEqual(
        context.db.orm.get<{ count: bigint }>(sql`SELECT count(*) AS count FROM content_snapshots`)
          ?.count,
        0n
      );
      test.assert.ok(
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

      test.assert.strictEqual(
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
      await test
        .expect(
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
        )
        .rejects.toSatisfy(() => true);
      test.assert.strictEqual(
        context.db.orm.get<{ count: bigint }>(sql`SELECT count(*) AS count FROM content_snapshots`)
          ?.count,
        1n
      );
      test.assert.strictEqual(
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
      test.assert.strictEqual(
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
      test.assert.ok(
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
  }
);

test.stable(
  'source reads distinguish absence and enforce bounded pagination',
  async ({ databases }) => {
    const location = await databases();
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

      test
        .expect(
          (
            await Effect.runPromise(
              Effect.runSync(
                useStore(SourceStore).pipe(Effect.provideService(Database, { store: context }))
              ).sources({ limit: 1 })
            )
          ).map((s) => s.id)
        )
        .toStrictEqual([b.id]);
      test
        .expect(
          (
            await Effect.runPromise(
              Effect.runSync(
                useStore(SourceStore).pipe(Effect.provideService(Database, { store: context }))
              ).sources({ limit: 1, before: b.id })
            )
          ).map((s) => s.id)
        )
        .toStrictEqual([a.id]);
      test.assert.ok(
        Option.isNone(
          await Effect.runPromise(
            Effect.runSync(
              useStore(SourceStore).pipe(Effect.provideService(Database, { store: context }))
            ).findSource(999n as typeof a.id)
          )
        )
      );
      await test
        .expect(
          Effect.runPromise(
            Effect.runSync(
              useStore(SourceStore).pipe(Effect.provideService(Database, { store: context }))
            ).source(999n as typeof a.id)
          )
        )
        .rejects.toSatisfy(() => true);
      await test
        .expect(
          Effect.runPromise(
            Effect.runSync(
              useStore(SourceStore).pipe(Effect.provideService(Database, { store: context }))
            ).sources({ limit: 0 })
          )
        )
        .rejects.toSatisfy(() => true);
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
