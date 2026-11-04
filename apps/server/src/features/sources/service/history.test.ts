/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises source history behavior through real persistence boundaries.             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies source history respects authored and raw citation pins even after private     │
 * │   reply captures have gone.                                                              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { DocumentsRpc } from '@study/contracts/documents/rpc';
import { plainBlock } from '@study/contracts/sources/document';
import { SourcesRpc } from '@study/contracts/sources/rpc';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Documents } from '#server/features/documents/index';
import { DocumentsRpcLive } from '#server/features/documents/rpc/index';
import { Sources } from '#server/features/sources/index';
import { SourcesRpcLive } from '#server/features/sources/rpc/index';
import { SourceStore } from '#server/features/sources/store/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';

const document = (text: string) => ({
  blocks: [plainBlock('paragraph', text, { type: 'paragraph', index: 0 })],
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
  const location = createTestDatabase(process.env.STUDY_FINAL_MIGRATIONS);
  const context = new ServerContext(location.open());
  const handlers = Layer.mergeAll(DocumentsRpcLive, SourcesRpcLive).pipe(
    Layer.provideMerge(Layer.mergeAll(Documents.layer, Sources.layer)),
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  return {
    context,
    handlers,
    close() {
      context.close();
      location.cleanup();
    }
  };
}

function setup() {
  return Effect.gen(function* () {
    const sources = yield* Sources;
    const bytes = new TextEncoder().encode('Original bytes');
    const source = yield* sources.createSource({ name: 'history.txt', bytes, projectId: null });
    const snapshots = [];

    for (const text of ['First extraction', 'Corrected extraction', 'Current extraction']) {
      const state = yield* sources.requestSourceProcessing({ id: source.id, expectedRevision: 1 });
      const result = yield* transaction((tx) =>
        tx.store(SourceStore).publishSourceDocument({
          id: source.id,
          expectedRevision: 1,
          requestId: state.requestId!,
          document: document(text)
        })
      );

      snapshots.push(result.documentId);
    }

    return { source, bytes, snapshots };
  });
}

testStable(
  'source history respects authored and raw citation pins even after private reply captures have gone',
  async () => {
    const f = fixture();

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(SourcesRpc.merge(DocumentsRpc));
            const saved = yield* setup();
            const [first, second] = saved.snapshots;

            assert.ok(first && second);
            const copy = yield* rpc['documents.copySource']({
              createKey: 'history-copy',
              title: 'Independent copy',
              sourceId: saved.source.id,
              revision: 1n,
              snapshotId: first
            });

            f.context.db.exec(
              "INSERT INTO sessions(id,title,title_source,created_at,updated_at) VALUES(1,'Raw copy','user',1,1); INSERT INTO messages(id,session_id,role,created_at) VALUES(1,1,'assistant',1); INSERT INTO message_versions(id,message_id,number,origin,status,text,created_at) VALUES(1,1,1,'typed','complete','Historic [1]',1)"
            );
            f.context.db.orm.run(
              sql`INSERT INTO citations(version_id,marker,source_id,source_revision,document_id,source_name,anchor,quote) VALUES(1,1,${saved.source.id},1,${second},'history.txt','{"type":"paragraph","index":0}','Corrected extraction')`
            );
            const preview = yield* rpc['sources.previewHistory']({
              sourceId: saved.source.id,
              keepLatest: 1
            });

            expect(preview.candidates.map((item) => item.snapshotId)).toStrictEqual([
              first,
              second
            ]);
            expect(preview.blockedSnapshotIds).toStrictEqual([first, second]);
            assert.ok(
              (yield* rpc['sources.previewDeletion']({ id: saved.source.id })).blockedBy.includes(
                'exact_inputs'
              )
            );
            assert.ok(
              (yield* Effect.flip(
                rpc['sources.retireHistory']({
                  sourceId: saved.source.id,
                  keepLatest: 1,
                  token: preview.token
                })
              )).kind === 'invalid_input'
            );
            assert.throws(() =>
              f.context.db.orm.run(
                sql`DELETE FROM source_extraction_revisions WHERE snapshot_id=${second}`
              )
            );
            const deletion = yield* rpc['documents.previewDeletion']({ id: copy.id });

            yield* rpc['documents.delete']({ documentId: copy.id, token: deletion.token });
            f.context.db.exec('DELETE FROM sessions WHERE id=1');
            assert.ok(
              (yield* Effect.flip(
                rpc['sources.retireHistory']({
                  sourceId: saved.source.id,
                  keepLatest: 1,
                  token: preview.token
                })
              )).kind === 'invalid_input'
            );
            const fresh = yield* rpc['sources.previewHistory']({
              sourceId: saved.source.id,
              keepLatest: 1
            });

            expect(fresh.blockedSnapshotIds).toStrictEqual([]);
            yield* rpc['sources.retireHistory']({
              sourceId: saved.source.id,
              keepLatest: 1,
              token: fresh.token
            });
            expect(
              (yield* rpc['sources.extractions']({
                sourceId: saved.source.id,
                limit: 10
              })).items.map((item) => item.snapshotId)
            ).toStrictEqual(saved.snapshots.slice(2));
            expect(
              (yield* rpc['sources.exportRevision']({ sourceId: saved.source.id, revision: 1n }))
                .bytes
            ).toStrictEqual(saved.bytes);
            expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
          })
        ).pipe(Effect.provide(f.handlers))
      );
    } finally {
      f.close();
    }
  }
);

testStable(
  'source history preview fences new publication and rolls body removal back with its outbox',
  async () => {
    const f = fixture();

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(SourcesRpc);
            const sources = yield* Sources;
            const saved = yield* setup();
            const preview = yield* rpc['sources.previewHistory']({
              sourceId: saved.source.id,
              keepLatest: 1
            });
            const pending = yield* sources.requestSourceProcessing({
              id: saved.source.id,
              expectedRevision: 1
            });

            assert.ok(
              (yield* Effect.flip(
                rpc['sources.retireHistory']({
                  sourceId: saved.source.id,
                  keepLatest: 1,
                  token: preview.token
                })
              )).kind === 'invalid_input'
            );
            const latest = yield* transaction((tx) =>
              tx.store(SourceStore).publishSourceDocument({
                id: saved.source.id,
                expectedRevision: 1,
                requestId: pending.requestId!,
                document: document('Newest')
              })
            );
            const fresh = yield* rpc['sources.previewHistory']({
              sourceId: saved.source.id,
              keepLatest: 1
            });
            const before = f.context.db.orm.all(sql`SELECT * FROM content_snapshots ORDER BY id`);

            f.context.db.exec(
              "CREATE TRIGGER reject_history_event BEFORE INSERT ON workflow_events WHEN NEW.type='SourceHistoryPruned' BEGIN SELECT RAISE(ABORT,'injected history failure'); END"
            );
            yield* Effect.flip(
              rpc['sources.retireHistory']({
                sourceId: saved.source.id,
                keepLatest: 1,
                token: fresh.token
              })
            );
            expect(
              f.context.db.orm.all(sql`SELECT * FROM content_snapshots ORDER BY id`)
            ).toStrictEqual(before);
            assert.strictEqual(
              (yield* rpc['sources.extractions']({ sourceId: saved.source.id, limit: 10 })).items
                .length,
              4
            );
            f.context.db.exec('DROP TRIGGER reject_history_event');
            const retired = yield* rpc['sources.retireHistory']({
              sourceId: saved.source.id,
              keepLatest: 1,
              token: fresh.token
            });

            assert.strictEqual(retired.candidates.length, 3);
            assert.strictEqual(
              (yield* rpc['sources.currentExtraction']({ id: saved.source.id }))?.snapshotId,
              latest.documentId
            );
            expect(
              (yield* rpc['sources.exportRevision']({ sourceId: saved.source.id, revision: 1n }))
                .bytes
            ).toStrictEqual(saved.bytes);
            assert.strictEqual(
              (yield* rpc['sources.previewHistory']({ sourceId: saved.source.id, keepLatest: 1 }))
                .candidates.length,
              0
            );
            assert.strictEqual(
              f.context.db.orm.get(
                sql`SELECT count(*) n FROM workflow_events WHERE type='SourceHistoryPruned'`
              )?.n,
              1n
            );
            expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
          })
        ).pipe(Effect.provide(f.handlers))
      );
    } finally {
      f.close();
    }
  }
);

testStable(
  'deletes only the selected attachment extraction through the history boundary',
  async () => {
    const f = fixture();

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(SourcesRpc);
            const saved = yield* setup();
            const [first, second, current] = saved.snapshots;

            assert.ok(first && second && current);
            const input = { sourceId: saved.source.id, keepLatest: 1, snapshotId: second };
            const preview = yield* rpc['sources.previewHistory'](input);

            expect(preview.candidates.map((item) => item.snapshotId)).toEqual([second]);
            yield* rpc['sources.retireHistory']({ ...input, token: preview.token });
            const history = yield* rpc['sources.extractions']({
              sourceId: saved.source.id,
              limit: 100
            });

            expect(history.items.map((item) => item.snapshotId)).toEqual([current, first]);
            expect(
              (yield* rpc['sources.previewHistory']({ ...input, snapshotId: current })).candidates
            ).toEqual([]);
            expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
          })
        ).pipe(Effect.provide(f.handlers))
      );
    } finally {
      f.close();
    }
  }
);
