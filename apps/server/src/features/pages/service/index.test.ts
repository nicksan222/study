import { pageVersionIdSchema, sourceIdSchema, versionIdSchema } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises authored Page index behavior through real persistence boundaries.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies native Pages RPC retains conflict alternatives and exact idempotent           │
 * │   receipts across reopen.                                                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { PagesRpc } from '@study/contracts';
import type { PageVersion } from '@study/contracts';
import { createBlock } from '@study/contracts';
import { sql } from '@study/db';
import type { Db } from '@study/db';
import { test } from '@study/testing';
import { Effect, Layer, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Pages } from '#server/features/pages/index';
import { PagesRpcLive } from '#server/features/pages/rpc/index';
import { SourceStore } from '#server/features/sources/store/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';
import { testLiveQueries } from '#testing/live-queries';

const body = (text: string, id?: PageVersion['document']['blocks'][number]['id']) => ({
  blocks: [
    createBlock(
      { type: 'paragraph', inlines: [{ type: 'text', text, marks: ['strong'] }] },
      { type: 'authored' },
      id
    )
  ],
  meta: {
    extractor: null,
    extractorVersion: 0,
    provider: null,
    durationMs: null,
    pageCount: null,
    refiners: [],
    waitingFor: [],
    corrected: false,
    omissions: []
  }
});

const creation = (createKey: string, text = 'Original') => ({
  createKey,
  title: 'Authored',
  document: body(text),
  inputs: [],
  citations: []
});

type Databases = () => Promise<{ open(): Promise<Db>; cleanup(): Promise<void>; path: string }>;

async function fixture(databases: Databases) {
  const location = await databases();
  const context = new ServerContext(await location.open());
  const services = Pages.layer.pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  return {
    location,
    context,
    services,
    close: async () => {
      context.close();
      await location.cleanup();
    }
  };
}

test.stable(
  'native Pages RPC retains conflict alternatives and exact idempotent receipts across reopen',
  async ({ databases }) => {
    const f = await fixture(databases);
    const input = creation('native-create');

    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpc = yield* RpcTest.makeClient(PagesRpc);
          const a = yield* rpc['pages.create'](input);

          test.assert.ok(a.version);
          test.assert.ok(
            a.createdAt < 100000000000n,
            'SQLite authored timestamps use Unix seconds'
          );
          test.assert.strictEqual((yield* rpc['pages.create'](input)).id, a.id);
          test.assert.ok(
            (yield* Effect.flip(rpc['pages.create']({ ...input, title: 'Other' }))).kind ===
              'invalid_input'
          );
          const base = a.version;
          const edit = {
            pageId: a.id,
            expectedVersionId: base.id,
            key: 'first',
            document: body('Saved 😀', base.document.blocks[0].id)
          };
          const saved = yield* rpc['pages.save'](edit);

          test.assert.ok(saved.outcome === 'saved');
          test.assert.ok((yield* rpc['pages.save'](edit)).replayed === true);
          const conflictInput = {
            ...edit,
            key: 'stale',
            document: body('Retained conflict', base.document.blocks[0].id)
          };
          const conflict = yield* rpc['pages.save'](conflictInput);

          test.assert.ok(conflict.outcome === 'conflict');
          const replay = yield* rpc['pages.save'](conflictInput);

          test.expect(replay).toStrictEqual({ ...conflict, replayed: true });
          const old = yield* rpc['pages.version']({ id: base.id });
          const alternative = yield* rpc['pages.version']({ id: conflict.submittedVersionId });

          test.assert.ok(old.document.blocks[0].text === 'Original');
          test.assert.ok(alternative.status === 'draft');
          test.assert.ok(alternative.document.blocks[0].text === 'Retained conflict');
          test.assert.strictEqual(
            (yield* rpc['pages.page']({ id: a.id })).headVersionId,
            saved.submittedVersionId
          );
          const comparison = yield* rpc['pages.compare']({
            beforeVersionId: base.id,
            proposedVersionId: conflict.submittedVersionId,
            currentVersionId: saved.submittedVersionId
          });

          test.assert.ok(comparison.proposedChanges[0]?.kind === 'changed');
          test.assert.ok(comparison.currentChanges[0]?.kind === 'changed');
          test.assert.ok(
            (yield* Effect.flip(
              rpc['pages.save']({
                ...edit,
                document: body('Different', base.document.blocks[0].id)
              })
            )).kind === 'invalid_input'
          );
          const restored = yield* rpc['pages.restore']({
            pageId: a.id,
            expectedVersionId: saved.submittedVersionId,
            restoreVersionId: base.id,
            key: 'restore'
          });

          test.assert.ok(restored.outcome === 'saved');
          const latest = yield* rpc['pages.version']({ id: restored.submittedVersionId });

          test.assert.ok(latest.operation === 'restore');
          test.expect(latest.document).toStrictEqual(base.document);
          test
            .expect(new Set(latest.parents))
            .toStrictEqual(new Set([base.id, saved.submittedVersionId]));
          const exported = yield* rpc['pages.exportVersion']({ id: latest.id });

          test.assert.strictEqual(JSON.parse(exported.content).id, String(latest.id));
          test.assert.strictEqual(
            (yield* rpc['pages.versions']({ pageId: a.id, limit: 2 })).items.length,
            2
          );

          return { id: a.id, latestId: latest.id, conflictInput, conflict };
        }).pipe(
          Effect.provide(
            PagesRpcLive.pipe(Layer.provide(testLiveQueries)).pipe(Layer.provide(f.services))
          ),
          Effect.scoped
        )
      );

      test.assert.strictEqual(
        f.context.db.orm.get(sql`SELECT count(*) AS n FROM materials`)?.n,
        0n
      );
      test.assert.strictEqual(
        f.context.db.orm.get(sql`SELECT count(*) AS n FROM material_versions`)?.n,
        0n
      );
      test.assert.throws(() =>
        f.context.db.exec(
          `UPDATE blocks SET text='tampered' WHERE document_id=(SELECT content_snapshot_id FROM page_versions WHERE id=${result.latestId})`
        )
      );
      f.context.close();
      const context = new ServerContext(await f.location.open());

      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Pages;

            test.assert.strictEqual(
              (yield* docs.page({ id: result.id })).headVersionId,
              result.latestId
            );
            test.expect(yield* docs.save(result.conflictInput)).toStrictEqual({
              ...result.conflict,
              replayed: true
            });
          }).pipe(
            Effect.provide(
              Pages.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })))
            )
          )
        );
        test.expect(context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
      } finally {
        context.close();
      }
    } finally {
      await f.location.cleanup();
    }
  }
);

test.stable(
  'editing ownership, transactional rollback and independent note membership are enforced',
  async ({ databases }) => {
    const f = await fixture(databases);

    try {
      f.context.db.exec(
        `INSERT INTO notes(id,title,title_source,created_at,updated_at) VALUES(1,'Note','user',1,1);`
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Pages;
          const a = yield* docs.create(creation('one'));
          const b = yield* docs.create(creation('two'));

          test.assert.ok(a.version && b.version);
          test.assert.ok(
            (yield* Effect.flip(
              docs.save({
                pageId: b.id,
                expectedVersionId: a.version.id,
                key: 'foreign-base',
                document: body('Forged')
              })
            )).kind === 'invalid_input'
          );
          test.assert.ok(
            (yield* Effect.flip(
              docs.save({
                pageId: b.id,
                expectedVersionId: b.version.id,
                key: 'foreign-block',
                document: a.version.document
              })
            )).kind === 'invalid_input'
          );
          test.assert.ok(
            (yield* Effect.flip(
              docs.restore({
                pageId: b.id,
                expectedVersionId: b.version.id,
                restoreVersionId: a.version.id,
                key: 'foreign-restore'
              })
            )).kind === 'invalid_input'
          );
          const missing = Schema.decodeUnknownSync(pageVersionIdSchema)(999999n);

          test.assert.ok(
            (yield* Effect.flip(
              docs.save({
                pageId: a.id,
                expectedVersionId: missing,
                key: 'missing',
                document: body('No')
              })
            )).kind === 'not_found'
          );
          yield* docs.archive({ id: a.id, archived: true });
          test.assert.strictEqual(
            (yield* docs.pages({ limit: 10, archived: false })).items.length,
            1
          );
          test.assert.strictEqual(
            (yield* docs.pages({ limit: 10, archived: true })).items[0]?.id,
            a.id
          );
          test.assert.ok(
            (yield* Effect.flip(docs.create({ ...creation('rollback'), noteId: 999n as never })))
              .kind === 'not_found'
          );
        }).pipe(Effect.provide(f.services))
      );
      test.assert.strictEqual(f.context.db.orm.get(sql`SELECT count(*) AS n FROM pages`)?.n, 2n);
      f.context.db.exec(
        `INSERT INTO note_pages(note_id,page_id,position) SELECT 1,id,id FROM pages; DELETE FROM notes;`
      );
      test.assert.strictEqual(f.context.db.orm.get(sql`SELECT count(*) AS n FROM pages`)?.n, 2n);
      test.assert.strictEqual(
        f.context.db.orm.get(sql`SELECT count(*) AS n FROM note_pages`)?.n,
        0n
      );
    } finally {
      await f.close();
    }
  }
);

test.stable(
  'source copies and message provenance pin exact inputs without giving notes ownership',
  async ({ databases }) => {
    const f = await fixture(databases);

    try {
      const sourceId = Schema.decodeUnknownSync(sourceIdSchema)(7n),
        messageVersionId = Schema.decodeUnknownSync(versionIdSchema)(11n);
      const source = body('Exact source 😀');

      f.context.db
        .exec(`INSERT INTO sources(id,origin,kind,mime,name,size_bytes,sha256,created_at) VALUES(7,'attachment','text','text/plain','Source',1,zeroblob(32),1);
  INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime) VALUES(7,1,X'41','text','text/plain'),(7,2,X'42','text','text/plain');
  INSERT INTO content_snapshots(id,source_id,extractor_version,meta,created_at) VALUES(70,7,0,'${JSON.stringify(source.meta)}',1);
  INSERT INTO blocks(document_id,ordinal,kind,editing_id,content,text,anchor) VALUES(70,0,'paragraph','source-block','${JSON.stringify(source.blocks[0].content)}','Exact source 😀','{"type":"page","page":1}');
  INSERT INTO source_processing(source_id,revision,request_id,published_request_id,document_id) VALUES(7,1,'source-1','source-1',70);
  INSERT INTO notes(id,title,title_source,created_at,updated_at) VALUES(1,'Note','user',1,1);
  INSERT INTO messages(id,note_id,role,created_at) VALUES(10,1,'user',1);
  INSERT INTO message_versions(id,message_id,number,origin,status,text,created_at) VALUES(11,10,1,'typed','complete','Exact message',1);`);
      const snapshotId = Schema.decodeUnknownSync(
        (await import('@study/contracts')).contentSnapshotIdSchema
      )(70n);

      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Pages;
          const copyInput = {
            createKey: 'copy',
            title: 'Copy',
            sourceId,
            revision: 1n,
            snapshotId
          };
          const copy = yield* docs.copySource(copyInput);

          test.assert.ok(copy.version);
          test.assert.strictEqual((yield* docs.copySource(copyInput)).id, copy.id);
          test.assert.ok(copy.version.document.blocks[0].text === 'Exact source 😀');
          test.assert.notStrictEqual(copy.version.document.blocks[0].id, source.blocks[0].id);
          test
            .expect(copy.version.inputs)
            .toStrictEqual([{ kind: 'source', sourceId, revision: 1n, snapshotId }]);
          test.assert.ok(
            (yield* Effect.flip(transaction((tx) => tx.store(SourceStore).deleteSource(sourceId))))
              .kind === 'invalid_input'
          );
          test.assert.ok(
            (yield* Effect.flip(
              docs.copySource({ ...copyInput, createKey: 'wrong-revision', revision: 2n })
            )).kind === 'not_found'
          );
          const input = { kind: 'message' as const, versionId: messageVersionId };
          const linked = yield* docs.create({
            ...creation('message-derived'),
            inputs: [input],
            citations: [
              {
                marker: 1,
                input,
                anchor: { type: 'authored' },
                target: null,
                quote: 'Exact message'
              }
            ]
          });

          test.assert.ok(linked.version);
          test.expect(linked.version.inputs).toStrictEqual([input]);
          test.expect(linked.version.unavailableInputs).toStrictEqual([]);
          f.context.db.exec('DELETE FROM notes WHERE id=1');
          const retained = yield* docs.version({ id: linked.version.id });

          test.expect(retained.inputs).toStrictEqual([input]);
          test.expect(retained.unavailableInputs).toStrictEqual([input]);
          test.assert.ok(retained.citations[0]?.quote === 'Exact message');
          test.assert.ok(
            f.context.db.orm.get(
              sql`SELECT message_version_id FROM page_inputs WHERE exact_message_version_id=11`
            )?.message_version_id === null
          );
        }).pipe(Effect.provide(f.services))
      );
      test.assert.throws(() =>
        f.context.db.exec(`DELETE FROM source_snapshots WHERE source_id=7 AND revision=1`)
      );
      test.expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
    } finally {
      await f.close();
    }
  }
);

test.stable(
  'history and deletion require an exact preview, protect dependents, and retire bodies with backup integrity',
  async ({ databases }) => {
    const f = await fixture(databases);

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Pages;
          const a = yield* docs.create(creation('history'));

          test.assert.ok(a.version);
          const edit = yield* docs.save({
            pageId: a.id,
            expectedVersionId: a.version.id,
            key: 'edit',
            document: body('Latest', a.version.document.blocks[0].id)
          });
          const old = yield* docs.previewHistory({ pageId: a.id, keepLatest: 1 });

          yield* docs.save({
            pageId: a.id,
            expectedVersionId: edit.submittedVersionId,
            key: 'another',
            document: body('Newest', a.version.document.blocks[0].id)
          });
          test.assert.ok(
            (yield* Effect.flip(
              docs.retireHistory({ pageId: a.id, keepLatest: 1, token: old.token })
            )).kind === 'invalid_input'
          );
          const fresh = yield* docs.previewHistory({ pageId: a.id, keepLatest: 1 });

          yield* docs.retireHistory({ pageId: a.id, keepLatest: 1, token: fresh.token });
          test.assert.ok(
            (yield* Effect.flip(docs.version({ id: a.version.id }))).kind === 'not_found'
          );
          test.assert.strictEqual(
            f.context.db.orm.get(
              sql`SELECT count(*) AS n FROM blocks WHERE document_id=${a.version.snapshotId}`
            )?.n,
            0n
          );
          const current = (yield* docs.page({ id: a.id })).version;

          test.assert.ok(current);
          const dependent = yield* docs.create({
            ...creation('dependent'),
            inputs: [{ kind: 'page', versionId: current.id }]
          });
          const blocked = yield* docs.previewDeletion({ id: a.id });

          test.expect(blocked.blockedVersionIds).toStrictEqual([current.id]);
          test.assert.ok(
            (yield* Effect.flip(docs.delete({ pageId: a.id, token: blocked.token }))).kind ===
              'invalid_input'
          );
          const deleteDependent = yield* docs.previewDeletion({ id: dependent.id });

          yield* docs.delete({ pageId: dependent.id, token: deleteDependent.token });
          const deletion = yield* docs.previewDeletion({ id: a.id });

          yield* docs.delete({ pageId: a.id, token: deletion.token });
          test.assert.ok((yield* Effect.flip(docs.page({ id: a.id }))).kind === 'not_found');
          test.assert.strictEqual(
            (yield* docs.pages({ limit: 10, archived: false })).items.length,
            0
          );
        }).pipe(Effect.provide(f.services))
      );
      test.expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
      test.assert.ok(f.context.db.orm.get(sql`PRAGMA integrity_check`)?.integrity_check === 'ok');
      const path = f.location.path + '.backup';

      await f.context.db.snapshot(path);
      const { Db } = await import('@study/db');

      test.assert.strictEqual(await Db.validateSnapshot(path), f.context.db.schemaIdentity());
    } finally {
      await f.close();
    }
  }
);

test.stable(
  'AI publication participant keeps one request intent and retains concurrent proposals',
  async ({ databases }) => {
    const f = await fixture(databases);

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Pages;
          const a = yield* docs.create(creation('generation'));

          test.assert.ok(a.version);
          const input = {
            requestId: 'generation-1',
            pageId: a.id,
            expectedVersionId: a.version.id,
            key: 'publication-1',
            document: body('Generated', a.version.document.blocks[0].id),
            inputs: [],
            citations: [],
            operation: 'summarize' as const,
            instruction: 'Summarize',
            language: null
          };
          const result = yield* transaction((tx) => Pages.publishInTransaction(tx, input));

          test.assert.ok(result.outcome === 'saved');
          test.assert.ok(
            (yield* transaction((tx) => Pages.publishInTransaction(tx, input))).replayed === true
          );
          const conflict = yield* transaction((tx) =>
            Pages.publishInTransaction(tx, {
              ...input,
              requestId: 'generation-2',
              key: 'publication-2',
              document: body('Proposal', a.version!.document.blocks[0].id)
            })
          );

          test.assert.ok(conflict.outcome === 'conflict');
          test.assert.ok(
            (yield* docs.version({ id: conflict.submittedVersionId })).status === 'draft'
          );
          test.assert.ok(
            (yield* Effect.flip(
              transaction((tx) =>
                Pages.publishInTransaction(tx, { ...input, instruction: 'Different' })
              )
            )).kind === 'invalid_input'
          );
        }).pipe(Effect.provide(f.services))
      );
      test.assert.strictEqual(
        f.context.db.orm.get(sql`SELECT count(*) AS n FROM page_generation_requests`)?.n,
        2n
      );
      test.assert.strictEqual(
        f.context.db.orm.get(sql`SELECT count(*) AS n FROM page_proposals`)?.n,
        1n
      );
    } finally {
      await f.close();
    }
  }
);

test.stable(
  'exact citations, Unicode annotation history, image pins and inherited retired message identities are validated',
  async ({ databases }) => {
    const f = await fixture(databases);

    try {
      f.context.db
        .exec(`INSERT INTO sources(id,origin,kind,mime,name,size_bytes,sha256,created_at) VALUES(8,'attachment','image','image/png','Image',1,zeroblob(32),1);
   INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime) VALUES(8,1,X'41','image','image/png');
   INSERT INTO notes(id,title,title_source,created_at,updated_at) VALUES(1,'Note','user',1,1);
   INSERT INTO messages(id,note_id,role,created_at) VALUES(10,1,'user',1);
   INSERT INTO message_versions(id,message_id,number,origin,status,text,created_at) VALUES(11,10,1,'typed','complete','Exact raw',1);`);
      const ids = await import('@study/contracts');

      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Pages;
          const base = creation('rich-evidence', 'A😀B');

          base.document.blocks.push(
            createBlock({
              type: 'image',
              sourceId: Schema.decodeUnknownSync(ids.sourceIdSchema)(8n),
              revision: 1,
              alt: ''
            }) as never
          );
          const a = yield* docs.create(base);

          test.assert.ok(a.version);
          test.assert.strictEqual(
            f.context.db.orm.get(
              sql`SELECT count(*) AS n FROM document_assets WHERE document_id=${a.version.snapshotId}`
            )?.n,
            1n
          );
          const target = {
            pageId: a.id,
            range: {
              versionId: a.version.id,
              snapshotId: a.version.snapshotId,
              blockId: a.version.document.blocks[0].id,
              start: 1,
              end: 3
            }
          };
          const annotation = yield* docs.createAnnotation({
            target,
            kind: 'highlight',
            note: 'Exact 😀'
          });

          test.assert.ok(annotation.outcome === 'saved');
          const invalid = yield* Effect.flip(
            docs.createAnnotation({
              target: { ...target, range: { ...target.range, start: 2 } },
              kind: 'note',
              note: 'Split surrogate'
            })
          );

          test.assert.ok(invalid.kind === 'invalid_input');
          const updated = yield* docs.reviseAnnotation({
            id: annotation.annotation.id,
            expectedRevision: 1n,
            target,
            kind: 'note',
            note: 'Revised',
            deleted: false
          });

          test.assert.strictEqual(updated.annotation.revision, 2n);
          const stale = yield* docs.reviseAnnotation({
            id: annotation.annotation.id,
            expectedRevision: 1n,
            target,
            kind: 'note',
            note: 'Stale',
            deleted: false
          });

          test.assert.ok(stale.outcome === 'conflict');
          test.assert.strictEqual(
            (yield* docs.annotationHistory({ id: annotation.annotation.id, limit: 10 })).items
              .length,
            2
          );
          const extra = yield* docs.createAnnotation({
            target,
            kind: 'note',
            note: 'Second annotation'
          });
          const firstAnnotations = yield* docs.annotations({
            pageId: a.id,
            versionId: a.version.id,
            limit: 1,
            includeDeleted: false
          });

          test.assert.strictEqual(firstAnnotations.items[0].id, extra.annotation.id);
          test.assert.strictEqual(firstAnnotations.nextCursor, extra.annotation.id);
          const nextAnnotations = yield* docs.annotations({
            pageId: a.id,
            limit: 1,
            cursor: firstAnnotations.nextCursor!,
            includeDeleted: false
          });

          test.assert.ok(nextAnnotations.items[0].note === 'Revised');
          test.assert.strictEqual(nextAnnotations.items[0].revision, 2n);
          test.assert.ok(nextAnnotations.nextCursor === null);
          yield* docs.reviseAnnotation({
            id: extra.annotation.id,
            expectedRevision: 1n,
            target,
            kind: 'note',
            note: 'Retained tombstone',
            deleted: true
          });
          test.assert.strictEqual(
            (yield* docs.annotations({ pageId: a.id, limit: 10, includeDeleted: false })).items
              .length,
            1
          );
          test.assert.strictEqual(
            (yield* docs.annotations({ pageId: a.id, limit: 10, includeDeleted: true })).items
              .length,
            2
          );
          const input = { kind: 'page' as const, versionId: a.version.id };
          const cited = yield* docs.create({
            ...creation('cited'),
            inputs: [input],
            citations: [
              {
                marker: 1,
                input,
                anchor: { type: 'authored' },
                target: { blockId: target.range.blockId, start: 1, end: 3 },
                quote: '😀'
              }
            ]
          });

          test.assert.ok(cited.version);
          test.assert.ok(
            (yield* Effect.flip(
              docs.create({
                ...creation('bad-quote'),
                inputs: [input],
                citations: [
                  {
                    marker: 1,
                    input,
                    anchor: { type: 'authored' },
                    target: { blockId: target.range.blockId, start: 1, end: 3 },
                    quote: 'False'
                  }
                ]
              })
            )).kind === 'invalid_input'
          );
          const messageInput = {
            kind: 'message' as const,
            versionId: Schema.decodeUnknownSync(ids.versionIdSchema)(11n)
          };
          const derived = yield* docs.create({
            ...creation('raw-derived'),
            inputs: [messageInput]
          });

          test.assert.ok(derived.version);
          f.context.db.exec('DELETE FROM notes WHERE id=1');
          const changed = yield* docs.save({
            pageId: derived.id,
            expectedVersionId: derived.version.id,
            key: 'after-note',
            document: body('Still editable', derived.version.document.blocks[0].id)
          });

          test.assert.ok(changed.outcome === 'saved');
          test
            .expect((yield* docs.version({ id: changed.submittedVersionId })).inputs)
            .toStrictEqual([messageInput]);
        }).pipe(Effect.provide(f.services))
      );
      test.assert.throws(() =>
        f.context.db.exec(
          `UPDATE source_snapshots SET bytes=X'42' WHERE source_id=8 AND revision=1`
        )
      );
      test.expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
    } finally {
      await f.close();
    }
  }
);

test.stable(
  'independent generated publication owns the first authored version and replays one typed request',
  async ({ databases }) => {
    const f = await fixture(databases);

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const request = {
            requestId: 'independent-generation',
            title: 'Generated output',
            document: body('Published by agent'),
            inputs: [],
            citations: [],
            operation: 'generate' as const,
            instruction: 'Create an authored document',
            language: 'en'
          };
          const a = yield* transaction((tx) => Pages.createGeneratedInTransaction(tx, request));

          test.assert.ok(a.version);
          test.assert.ok(a.version.creator === 'agent');
          test.assert.ok(a.version.operation === 'generate');
          test.assert.strictEqual(a.version.number, 1n);
          test.expect(a.version.parents).toStrictEqual([]);
          test.assert.strictEqual(a.version.instruction, request.instruction);
          const docs = yield* Pages;

          yield* docs.save({
            pageId: a.pageId,
            expectedVersionId: a.version.id,
            key: 'later-edit',
            document: body('Later authored edit', a.version.document.blocks[0].id)
          });
          const replay = yield* transaction((tx) =>
            Pages.createGeneratedInTransaction(tx, request)
          );

          test.assert.strictEqual(replay.pageId, a.pageId);
          test.assert.strictEqual(replay.version.id, a.version.id);
          test.assert.ok(replay.replayed === true);
          test.assert.ok(
            (yield* Effect.flip(
              transaction((tx) =>
                Pages.createGeneratedInTransaction(tx, {
                  ...request,
                  instruction: 'Different intent'
                })
              )
            )).kind === 'invalid_input'
          );
          const receipt = f.context.db.orm.get(
            sql`SELECT expected_version_id,result_version_id FROM page_generation_requests WHERE id='independent-generation'`
          );

          test.assert.ok(receipt?.expected_version_id === null);
          test.assert.strictEqual(receipt?.result_version_id, a.version.id);
        }).pipe(Effect.provide(f.services))
      );
      test.assert.strictEqual(
        f.context.db.orm.get(sql`SELECT count(*) AS n FROM materials`)?.n,
        0n
      );
      test.assert.strictEqual(
        f.context.db.orm.get(sql`SELECT count(*) AS n FROM page_versions`)?.n,
        2n
      );
      test.expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
    } finally {
      await f.close();
    }
  }
);

test.stable(
  'authored metadata and target proposals retain independent histories and exact replay',
  async ({ databases }) => {
    const f = await fixture(databases);

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Pages;
          const created = yield* docs.create(creation('proposal-target'));
          const base = created.version!;
          const metadata = yield* docs.updateMetadata({
            id: created.id,
            title: 'Renamed document',
            description: 'Private description',
            expectedTitle: created.title,
            expectedDescription: created.description
          });

          test.assert.ok(metadata.title === 'Renamed document');
          test.assert.ok(metadata.description === 'Private description');
          test.assert.strictEqual(metadata.headVersionId, base.id);
          const proposalInput = {
            requestId: 'target-proposal',
            pageId: created.id,
            expectedVersionId: base.id,
            key: 'generate-target',
            document: body('Proposed text', base.document.blocks[0].id),
            inputs: [],
            citations: [],
            operation: 'generate' as const,
            instruction: 'Improve clarity',
            language: null
          };
          const proposed = yield* transaction((tx) =>
            Pages.proposeGeneratedInTransaction(tx, proposalInput)
          );

          test.assert.strictEqual(proposed.baseVersionId, base.id);
          test.assert.strictEqual((yield* docs.page({ id: created.id })).headVersionId, base.id);
          test.assert.ok(
            (yield* docs.version({ id: proposed.proposedVersionId })).status === 'draft'
          );
          test
            .expect(
              yield* transaction((tx) => Pages.proposeGeneratedInTransaction(tx, proposalInput))
            )
            .toStrictEqual(proposed);
          const changed = yield* docs.save({
            pageId: created.id,
            expectedVersionId: base.id,
            key: 'concurrent',
            document: body('Concurrent text', base.document.blocks[0].id)
          });
          const conflict = yield* docs.applyProposal({
            requestId: proposed.requestId,
            key: 'apply-stale',
            expectedVersionId: base.id
          });

          test.assert.ok(conflict.outcome === 'conflict');
          test.assert.strictEqual(conflict.currentVersionId, changed.submittedVersionId);
          const keepInput = {
            requestId: proposed.requestId,
            key: 'keep-separate',
            title: 'Alternative'
          };
          const kept = yield* docs.keepProposal(keepInput);

          test.assert.ok(kept.outcome === 'kept');
          test.assert.ok((yield* docs.keepProposal(keepInput)).replayed === true);
          const alternative = yield* docs.version({ id: kept.resultVersionId! });

          test.assert.notStrictEqual(alternative.pageId, created.id);
          test.assert.ok(alternative.document.blocks[0].text === 'Proposed text');
          test.assert.notStrictEqual(alternative.document.blocks[0].id, base.document.blocks[0].id);
          test.assert.strictEqual(
            (yield* docs.page({ id: created.id })).headVersionId,
            changed.submittedVersionId
          );
          test.assert.ok(
            (yield* Effect.flip(
              docs.applyProposal({
                requestId: proposed.requestId,
                key: 'apply-current',
                expectedVersionId: changed.submittedVersionId
              })
            )).kind === 'invalid_input'
          );
          const target = yield* docs.create(creation('fresh-proposal-target'));
          const fresh = yield* transaction((tx) =>
            Pages.proposeGeneratedInTransaction(tx, {
              ...proposalInput,
              pageId: target.id,
              expectedVersionId: target.version!.id,
              document: body('Accepted proposal', target.version!.document.blocks[0].id),
              requestId: 'fresh-target'
            })
          );
          const applyInput = {
            requestId: fresh.requestId,
            key: 'apply-exact',
            expectedVersionId: target.version!.id
          };
          const applied = yield* docs.applyProposal(applyInput);

          test.assert.ok(applied.outcome === 'applied');
          test.assert.strictEqual(
            (yield* docs.page({ id: target.id })).headVersionId,
            applied.resultVersionId
          );
          test.assert.ok(
            (yield* docs.version({ id: applied.resultVersionId! })).document.blocks[0].text ===
              'Accepted proposal'
          );
          const replay = yield* docs.applyProposal(applyInput);

          test.assert.ok(replay.replayed === true);
          test.assert.strictEqual(replay.resultVersionId, applied.resultVersionId);
          const retirement = yield* docs.previewDeletion({ id: target.id });

          test
            .expect(
              retirement.blockedVersionIds,
              'Own proposal identities do not retain deleted document bodies'
            )
            .toStrictEqual([]);
          yield* docs.delete({ pageId: target.id, token: retirement.token });
          test.assert.ok((yield* Effect.flip(docs.page({ id: target.id }))).kind === 'not_found');
          test.assert.ok((yield* docs.applyProposal(applyInput)).replayed === true);

          test.assert.ok(
            (yield* Effect.flip(
              docs.updateMetadata({
                id: created.id,
                title: 'Overwritten',
                description: null,
                expectedTitle: created.title,
                expectedDescription: created.description
              })
            )).kind === 'invalid_input'
          );
        }).pipe(Effect.provide(f.services))
      );
    } finally {
      await f.close();
    }
  }
);

test.stable(
  'history pagination follows logical numbers when exact version IDs have a different order',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Pages;
          const owner = yield* docs.create(creation('logical-order'));

          test.assert.ok(owner.version);
          // Late imported histories can have IDs in a different order from logical numbers.
          // Create valid draft snapshots without changing any published version or SQL guard.

          for (const [id, number] of [
            [100n, 2n],
            [50n, 3n]
          ]) {
            const snapshot = context.db.orm.get<{ id: bigint }>(
              sql`INSERT INTO content_snapshots(extractor_version,meta,created_at) SELECT extractor_version,meta,created_at FROM content_snapshots WHERE id=${owner.version.snapshotId} RETURNING id`
            )!;

            context.db.orm.run(
              sql`INSERT INTO blocks(document_id,ordinal,kind,editing_id,content,text,anchor) SELECT ${snapshot.id},ordinal,kind,editing_id,content,text,anchor FROM blocks WHERE document_id=${owner.version.snapshotId}`
            );
            context.db.orm.run(
              sql`INSERT INTO page_versions(id,page_id,number,content_snapshot_id,created_at) VALUES(${id},${owner.id},${number},${snapshot.id},1)`
            );
          }

          const first = yield* docs.versions({ pageId: owner.id, limit: 1 });

          test.assert.strictEqual(first.items[0]?.number, 3n);
          test.assert.strictEqual(first.items[0]?.id, 50n);
          test.assert.strictEqual(first.nextCursor, 50n);
          const second = yield* docs.versions({
            pageId: owner.id,
            limit: 1,
            cursor: first.nextCursor!
          });

          test.assert.strictEqual(second.items[0]?.number, 2n);
          test.assert.strictEqual(second.items[0]?.id, 100n);
          const last = yield* docs.versions({
            pageId: owner.id,
            limit: 1,
            cursor: second.nextCursor!
          });

          test.assert.strictEqual(last.items[0]?.id, owner.version.id);
          test.assert.ok(last.nextCursor === null);
        }).pipe(Effect.provide(Pages.layer), Effect.provideService(Database, { store: context }))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
