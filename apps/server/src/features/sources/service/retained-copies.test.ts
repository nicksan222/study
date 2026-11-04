/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Independent authored source pins keep exact original bytes until explicit source   │
 * │ deletion.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies retained identities and exact retained copies invariants.                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import { createBlock } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Documents } from '#server/features/documents/index';
import { Sources } from '#server/features/sources/index';
import { documentTransformFixture } from '#testing/document-transform';
import { deletionDocument } from '#testing/material-deletion';
import { recordingSource } from '#testing/recording-source';

for (const kind of ['file', 'image', 'recording'] as const)
  testStable(
    `independent ${kind} pins preserve exact exports until final source removal without affecting equal-hash bytes or raw PCM`,
    async () => {
      const f = await documentTransformFixture();

      try {
        const recordingId = kind === 'recording' ? await recordingSource(f) : null;
        const saved = await Effect.runPromise(
          Effect.gen(function* () {
            const sources = yield* Sources;
            const docs = yield* Documents;
            const source =
              recordingId === null
                ? yield* sources.createSource({
                    name: kind === 'image' ? 'copy.png' : 'copy.txt',
                    bytes:
                      kind === 'image'
                        ? new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
                        : new TextEncoder().encode('SOURCE_COPY_PRIVATE_BYTES'),
                    projectId: null
                  })
                : yield* sources.source(recordingId);
            const original = yield* sources.exportRevision({ sourceId: source.id, revision: 1n });
            const unrelated = yield* sources.createSource({
              name: source.name,
              bytes: original.bytes,
              projectId: null
            });
            const create = (title: string) =>
              docs.create({
                createKey: randomUUID(),
                title,
                document:
                  kind === 'image'
                    ? {
                        ...deletionDocument('Image'),
                        blocks: [
                          createBlock({
                            type: 'image',
                            sourceId: source.id,
                            revision: 1,
                            alt: 'Shared image'
                          })
                        ]
                      }
                    : deletionDocument('Independent source provenance'),
                inputs: [{ kind: 'source', sourceId: source.id, revision: 1n, snapshotId: null }],
                citations: []
              });
            const a = yield* create('First authored owner');
            const b = yield* create('Independent authored owner');

            assert.ok(a.version);
            assert.ok(b.version);
            const expected = yield* docs.exportVersion({ id: b.version.id });
            const preview = yield* docs.previewDeletion({ id: a.id });

            yield* docs.delete({ documentId: a.id, token: preview.token });
            assert.ok(
              (yield* Effect.flip(docs.exportVersion({ id: a.version.id }))).kind === 'not_found'
            );
            const blocked = yield* sources.previewDeletion({ id: source.id });

            assert.ok(blocked.blockedBy.includes('exact_inputs'));
            assert.ok(
              (yield* Effect.flip(sources.deleteSource({ id: source.id }))).kind === 'invalid_input'
            );
            expect(
              yield* sources.exportRevision({ sourceId: source.id, revision: 1n })
            ).toStrictEqual(original);
            expect(yield* docs.exportVersion({ id: b.version.id })).toStrictEqual(expected);

            return { source, unrelated, original, b: { ...b, version: b.version }, expected };
          }).pipe(Effect.provide(f.domain()))
        );

        f.reopen();

        for (const mutation of [
          sql`DELETE FROM source_snapshots WHERE source_id=${saved.source.id}`,
          sql`DELETE FROM sources WHERE id=${saved.source.id}`,
          sql`UPDATE source_snapshots SET bytes=x'00' WHERE source_id=${saved.source.id}`
        ])
          assert.throws(() => f.context.db.orm.run(mutation));

        const pcm = f.context.db.orm.select().from(s.recording_chunks).all();

        await Effect.runPromise(
          Effect.gen(function* () {
            const sources = yield* Sources;
            const docs = yield* Documents;

            expect(yield* docs.exportVersion({ id: saved.b.version.id })).toStrictEqual(
              saved.expected
            );
            const preview = yield* docs.previewDeletion({ id: saved.b.id });

            yield* docs.delete({ documentId: saved.b.id, token: preview.token });
            expect(
              (yield* sources.previewDeletion({ id: saved.source.id })).blockedBy
            ).toStrictEqual([]);
            f.context.db.exec(
              "CREATE TRIGGER reject_source_event BEFORE INSERT ON workflow_events WHEN NEW.type='SourceDeleted' BEGIN SELECT RAISE(ABORT,'injected'); END"
            );
            yield* Effect.flip(sources.deleteSource({ id: saved.source.id }));
            expect(
              yield* sources.exportRevision({ sourceId: saved.source.id, revision: 1n })
            ).toStrictEqual(saved.original);
            f.context.db.exec('DROP TRIGGER reject_source_event');
            yield* sources.deleteSource({ id: saved.source.id });
            assert.ok(
              (yield* Effect.flip(
                sources.exportRevision({ sourceId: saved.source.id, revision: 1n })
              )).kind === 'not_found'
            );
            expect(
              (yield* sources.exportRevision({ sourceId: saved.unrelated.id, revision: 1n })).bytes
            ).toStrictEqual(saved.original.bytes);
          }).pipe(Effect.provide(f.domain()))
        );
        f.reopen();
        assert.strictEqual(
          f.context.db.orm
            .select()
            .from(s.source_blobs)
            .where(eq(s.source_blobs.source_id, saved.source.id))
            .all().length,
          0
        );
        assert.strictEqual(
          f.context.db.orm
            .select()
            .from(s.source_snapshots)
            .where(eq(s.source_snapshots.source_id, saved.source.id))
            .all().length,
          0
        );
        expect(f.context.db.orm.select().from(s.recording_chunks).all()).toStrictEqual(pcm);

        if (kind === 'recording') assert.ok(pcm.length);

        expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
      } finally {
        await f.close();
      }
    }
  );
