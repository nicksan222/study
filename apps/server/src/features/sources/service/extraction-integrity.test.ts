/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises source extraction integrity behavior through real persistence            │
 * │ boundaries.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies an unpinned published source extraction is immutable until its retained       │
 * │   identity is released.                                                                  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { plainBlock } from '@study/contracts/sources/document';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Sources } from '#server/features/sources/index';
import { SourceStore } from '#server/features/sources/store/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';

testStable(
  'an unpinned published source extraction is immutable until its retained identity is released',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;
          const source = yield* sources.createSource({
            name: 'immutable.txt',
            bytes: new TextEncoder().encode('Original'),
            projectId: null
          });
          const state = yield* sources.sourceProcessing(source.id);
          const result = yield* transaction((tx) =>
            tx.store(SourceStore).publishSourceDocument({
              id: source.id,
              expectedRevision: 1,
              requestId: state.requestId!,
              document: {
                blocks: [plainBlock('paragraph', 'Original', { type: 'paragraph', index: 0 })],
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
              }
            })
          );
          const id = result.documentId;

          for (const statement of [
            sql`UPDATE blocks SET text='Forged' WHERE document_id=${id}`,
            sql`UPDATE blocks SET editing_id='forged' WHERE document_id=${id}`,
            sql`DELETE FROM blocks WHERE document_id=${id}`,
            sql`INSERT INTO blocks(document_id,ordinal,kind,editing_id,content,text,anchor) SELECT document_id,1,kind,'extra',content,text,anchor FROM blocks WHERE document_id=${id}`,
            sql`UPDATE content_snapshots SET meta='{}' WHERE id=${id}`,
            sql`DELETE FROM content_snapshots WHERE id=${id}`,
            sql`UPDATE source_extraction_revisions SET revision=revision WHERE snapshot_id=${id}`
          ])
            assert.throws(() => context.db.orm.run(statement));

          assert.strictEqual((yield* sources.currentExtraction({ id: source.id }))?.snapshotId, id);
          assert.strictEqual(yield* sources.deleteSource({ id: source.id }), true);
          assert.strictEqual(
            context.db.orm.get(sql`SELECT 1 FROM content_snapshots WHERE id=${id}`),
            undefined
          );
          expect(context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
        }).pipe(
          Effect.provide(Sources.layer),
          Effect.provide(Layer.succeed(Database, { store: context }))
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
