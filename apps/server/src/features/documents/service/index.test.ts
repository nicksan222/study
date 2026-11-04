/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises authored Document index behavior through real persistence boundaries.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies native Documents RPC retains conflict alternatives and exact idempotent       │
 * │   receipts across reopen.                                                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import { DocumentsRpc } from '@study/contracts/documents/rpc';
import type { StudyDocumentVersion } from '@study/contracts/documents/types';
import {
  studyDocumentVersionIdSchema,
  sourceIdSchema,
  versionIdSchema
} from '@study/contracts/ids';
import { createBlock } from '@study/contracts/sources/document';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/node';
import { Effect, Layer, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Documents } from '#server/features/documents/index';
import { DocumentsRpcLive } from '#server/features/documents/rpc/index';
import { SourceStore } from '#server/features/sources/store/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';

const body = (text: string, id?: StudyDocumentVersion['document']['blocks'][number]['id']) => ({
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

function fixture() {
  const location = createTestDatabase(process.env.STUDY_FINAL_MIGRATIONS);
  const context = new ServerContext(location.open());
  const services = Documents.layer.pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  return {
    location,
    context,
    services,
    close: () => {
      context.close();
      location.cleanup();
    }
  };
}

testStable(
  'native Documents RPC retains conflict alternatives and exact idempotent receipts across reopen',
  async () => {
    const f = fixture();
    const input = creation('native-create');

    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const rpc = yield* RpcTest.makeClient(DocumentsRpc);
          const a = yield* rpc['documents.create'](input);

          assert.ok(a.version);
          assert.ok(a.createdAt < 100000000000n, 'SQLite authored timestamps use Unix seconds');
          assert.equal((yield* rpc['documents.create'](input)).id, a.id);
          assert.equal(
            (yield* Effect.flip(rpc['documents.create']({ ...input, title: 'Other' }))).kind,
            'invalid_input'
          );
          const base = a.version;
          const edit = {
            documentId: a.id,
            expectedVersionId: base.id,
            key: 'first',
            document: body('Saved 😀', base.document.blocks[0].id)
          };
          const saved = yield* rpc['documents.save'](edit);

          assert.equal(saved.outcome, 'saved');
          assert.equal((yield* rpc['documents.save'](edit)).replayed, true);
          const conflictInput = {
            ...edit,
            key: 'stale',
            document: body('Retained conflict', base.document.blocks[0].id)
          };
          const conflict = yield* rpc['documents.save'](conflictInput);

          assert.equal(conflict.outcome, 'conflict');
          const replay = yield* rpc['documents.save'](conflictInput);

          assert.deepEqual(replay, { ...conflict, replayed: true });
          const old = yield* rpc['documents.version']({ id: base.id });
          const alternative = yield* rpc['documents.version']({ id: conflict.submittedVersionId });

          assert.equal(old.document.blocks[0].text, 'Original');
          assert.equal(alternative.status, 'draft');
          assert.equal(alternative.document.blocks[0].text, 'Retained conflict');
          assert.equal(
            (yield* rpc['documents.document']({ id: a.id })).headVersionId,
            saved.submittedVersionId
          );
          const comparison = yield* rpc['documents.compare']({
            beforeVersionId: base.id,
            proposedVersionId: conflict.submittedVersionId,
            currentVersionId: saved.submittedVersionId
          });

          assert.equal(comparison.proposedChanges[0]?.kind, 'changed');
          assert.equal(comparison.currentChanges[0]?.kind, 'changed');
          assert.equal(
            (yield* Effect.flip(
              rpc['documents.save']({
                ...edit,
                document: body('Different', base.document.blocks[0].id)
              })
            )).kind,
            'invalid_input'
          );
          const restored = yield* rpc['documents.restore']({
            documentId: a.id,
            expectedVersionId: saved.submittedVersionId,
            restoreVersionId: base.id,
            key: 'restore'
          });

          assert.equal(restored.outcome, 'saved');
          const latest = yield* rpc['documents.version']({ id: restored.submittedVersionId });

          assert.equal(latest.operation, 'restore');
          assert.deepEqual(latest.document, base.document);
          assert.deepEqual(new Set(latest.parents), new Set([base.id, saved.submittedVersionId]));
          const exported = yield* rpc['documents.exportVersion']({ id: latest.id });

          assert.equal(JSON.parse(exported.content).id, String(latest.id));
          assert.equal(
            (yield* rpc['documents.versions']({ documentId: a.id, limit: 2 })).items.length,
            2
          );

          return { id: a.id, latestId: latest.id, conflictInput, conflict };
        }).pipe(Effect.provide(DocumentsRpcLive.pipe(Layer.provide(f.services))), Effect.scoped)
      );

      assert.equal(f.context.db.orm.get(sql`SELECT count(*) AS n FROM materials`)?.n, 0n);
      assert.equal(f.context.db.orm.get(sql`SELECT count(*) AS n FROM material_versions`)?.n, 0n);
      assert.throws(() =>
        f.context.db.exec(
          `UPDATE blocks SET text='tampered' WHERE document_id=(SELECT content_snapshot_id FROM study_document_versions WHERE id=${result.latestId})`
        )
      );
      f.context.close();
      const context = new ServerContext(f.location.open());

      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Documents;

            assert.equal((yield* docs.document({ id: result.id })).headVersionId, result.latestId);
            assert.deepEqual(yield* docs.save(result.conflictInput), {
              ...result.conflict,
              replayed: true
            });
          }).pipe(
            Effect.provide(
              Documents.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })))
            )
          )
        );
        assert.deepEqual(context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
      } finally {
        context.close();
      }
    } finally {
      f.location.cleanup();
    }
  }
);

testStable(
  'editing ownership, transactional rollback and independent session membership are enforced',
  async () => {
    const f = fixture();

    try {
      f.context.db.exec(
        `INSERT INTO sessions(id,title,title_source,created_at,updated_at) VALUES(1,'Session','user',1,1);`
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Documents;
          const a = yield* docs.create(creation('one'));
          const b = yield* docs.create(creation('two'));

          assert.ok(a.version && b.version);
          assert.equal(
            (yield* Effect.flip(
              docs.save({
                documentId: b.id,
                expectedVersionId: a.version.id,
                key: 'foreign-base',
                document: body('Forged')
              })
            )).kind,
            'invalid_input'
          );
          assert.equal(
            (yield* Effect.flip(
              docs.save({
                documentId: b.id,
                expectedVersionId: b.version.id,
                key: 'foreign-block',
                document: a.version.document
              })
            )).kind,
            'invalid_input'
          );
          assert.equal(
            (yield* Effect.flip(
              docs.restore({
                documentId: b.id,
                expectedVersionId: b.version.id,
                restoreVersionId: a.version.id,
                key: 'foreign-restore'
              })
            )).kind,
            'invalid_input'
          );
          const missing = Schema.decodeUnknownSync(studyDocumentVersionIdSchema)(999999n);

          assert.equal(
            (yield* Effect.flip(
              docs.save({
                documentId: a.id,
                expectedVersionId: missing,
                key: 'missing',
                document: body('No')
              })
            )).kind,
            'not_found'
          );
          yield* docs.archive({ id: a.id, archived: true });
          assert.equal((yield* docs.documents({ limit: 10, archived: false })).items.length, 1);
          assert.equal((yield* docs.documents({ limit: 10, archived: true })).items[0]?.id, a.id);
          assert.equal(
            (yield* Effect.flip(docs.create({ ...creation('rollback'), sessionId: 999n as never })))
              .kind,
            'not_found'
          );
        }).pipe(Effect.provide(f.services))
      );
      assert.equal(f.context.db.orm.get(sql`SELECT count(*) AS n FROM study_documents`)?.n, 2n);
      f.context.db.exec(
        `INSERT INTO session_documents(session_id,document_id,position) SELECT 1,id,id FROM study_documents; DELETE FROM sessions;`
      );
      assert.equal(f.context.db.orm.get(sql`SELECT count(*) AS n FROM study_documents`)?.n, 2n);
      assert.equal(f.context.db.orm.get(sql`SELECT count(*) AS n FROM session_documents`)?.n, 0n);
    } finally {
      f.close();
    }
  }
);

testStable(
  'source copies and message provenance pin exact inputs without giving sessions ownership',
  async () => {
    const f = fixture();

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
  INSERT INTO sessions(id,title,title_source,created_at,updated_at) VALUES(1,'Session','user',1,1);
  INSERT INTO messages(id,session_id,role,created_at) VALUES(10,1,'user',1);
  INSERT INTO message_versions(id,message_id,number,origin,status,text,created_at) VALUES(11,10,1,'typed','complete','Exact message',1);`);
      const snapshotId = Schema.decodeUnknownSync(
        (await import('@study/contracts/ids')).contentSnapshotIdSchema
      )(70n);

      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Documents;
          const copyInput = {
            createKey: 'copy',
            title: 'Copy',
            sourceId,
            revision: 1n,
            snapshotId
          };
          const copy = yield* docs.copySource(copyInput);

          assert.ok(copy.version);
          assert.equal((yield* docs.copySource(copyInput)).id, copy.id);
          assert.equal(copy.version.document.blocks[0].text, 'Exact source 😀');
          assert.notEqual(copy.version.document.blocks[0].id, source.blocks[0].id);
          assert.deepEqual(copy.version.inputs, [
            { kind: 'source', sourceId, revision: 1n, snapshotId }
          ]);
          assert.equal(
            (yield* Effect.flip(transaction((tx) => tx.store(SourceStore).deleteSource(sourceId))))
              .kind,
            'invalid_input'
          );
          assert.equal(
            (yield* Effect.flip(
              docs.copySource({ ...copyInput, createKey: 'wrong-revision', revision: 2n })
            )).kind,
            'not_found'
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

          assert.ok(linked.version);
          assert.deepEqual(linked.version.inputs, [input]);
          f.context.db.exec('DELETE FROM sessions WHERE id=1');
          const retained = yield* docs.version({ id: linked.version.id });

          assert.deepEqual(retained.inputs, [input]);
          assert.equal(retained.citations[0]?.quote, 'Exact message');
          assert.equal(
            f.context.db.orm.get(
              sql`SELECT message_version_id FROM study_document_inputs WHERE exact_message_version_id=11`
            )?.message_version_id,
            null
          );
        }).pipe(Effect.provide(f.services))
      );
      assert.throws(() =>
        f.context.db.exec(`DELETE FROM source_snapshots WHERE source_id=7 AND revision=1`)
      );
      assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
    } finally {
      f.close();
    }
  }
);

testStable(
  'history and deletion require an exact preview, protect dependents, and retire bodies with backup integrity',
  async () => {
    const f = fixture();

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Documents;
          const a = yield* docs.create(creation('history'));

          assert.ok(a.version);
          const edit = yield* docs.save({
            documentId: a.id,
            expectedVersionId: a.version.id,
            key: 'edit',
            document: body('Latest', a.version.document.blocks[0].id)
          });
          const old = yield* docs.previewHistory({ documentId: a.id, keepLatest: 1 });

          yield* docs.save({
            documentId: a.id,
            expectedVersionId: edit.submittedVersionId,
            key: 'another',
            document: body('Newest', a.version.document.blocks[0].id)
          });
          assert.equal(
            (yield* Effect.flip(
              docs.retireHistory({ documentId: a.id, keepLatest: 1, token: old.token })
            )).kind,
            'invalid_input'
          );
          const fresh = yield* docs.previewHistory({ documentId: a.id, keepLatest: 1 });

          yield* docs.retireHistory({ documentId: a.id, keepLatest: 1, token: fresh.token });
          assert.equal((yield* Effect.flip(docs.version({ id: a.version.id }))).kind, 'not_found');
          assert.equal(
            f.context.db.orm.get(
              sql`SELECT count(*) AS n FROM blocks WHERE document_id=${a.version.snapshotId}`
            )?.n,
            0n
          );
          const current = (yield* docs.document({ id: a.id })).version;

          assert.ok(current);
          const dependent = yield* docs.create({
            ...creation('dependent'),
            inputs: [{ kind: 'document', versionId: current.id }]
          });
          const blocked = yield* docs.previewDeletion({ id: a.id });

          assert.deepEqual(blocked.blockedVersionIds, [current.id]);
          assert.equal(
            (yield* Effect.flip(docs.delete({ documentId: a.id, token: blocked.token }))).kind,
            'invalid_input'
          );
          const deleteDependent = yield* docs.previewDeletion({ id: dependent.id });

          yield* docs.delete({ documentId: dependent.id, token: deleteDependent.token });
          const deletion = yield* docs.previewDeletion({ id: a.id });

          yield* docs.delete({ documentId: a.id, token: deletion.token });
          assert.equal((yield* Effect.flip(docs.document({ id: a.id }))).kind, 'not_found');
          assert.equal((yield* docs.documents({ limit: 10, archived: false })).items.length, 0);
        }).pipe(Effect.provide(f.services))
      );
      assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
      assert.equal(f.context.db.orm.get(sql`PRAGMA integrity_check`)?.integrity_check, 'ok');
      const path = f.location.path + '.backup';

      await f.context.db.snapshot(path);
      const { Db } = await import('@study/db');

      if (process.env.STUDY_FINAL_MIGRATIONS)
        assert.throws(() => Db.validateSnapshot(path), TypeError);
      else assert.equal(Db.validateSnapshot(path), f.context.db.schemaIdentity());
    } finally {
      f.close();
    }
  }
);

testStable(
  'AI publication participant keeps one request intent and retains concurrent proposals',
  async () => {
    const f = fixture();

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Documents;
          const a = yield* docs.create(creation('generation'));

          assert.ok(a.version);
          const input = {
            requestId: 'generation-1',
            documentId: a.id,
            expectedVersionId: a.version.id,
            key: 'publication-1',
            document: body('Generated', a.version.document.blocks[0].id),
            inputs: [],
            citations: [],
            operation: 'summarize' as const,
            instruction: 'Summarize',
            language: null
          };
          const result = yield* transaction((tx) => Documents.publishInTransaction(tx, input));

          assert.equal(result.outcome, 'saved');
          assert.equal(
            (yield* transaction((tx) => Documents.publishInTransaction(tx, input))).replayed,
            true
          );
          const conflict = yield* transaction((tx) =>
            Documents.publishInTransaction(tx, {
              ...input,
              requestId: 'generation-2',
              key: 'publication-2',
              document: body('Proposal', a.version!.document.blocks[0].id)
            })
          );

          assert.equal(conflict.outcome, 'conflict');
          assert.equal((yield* docs.version({ id: conflict.submittedVersionId })).status, 'draft');
          assert.equal(
            (yield* Effect.flip(
              transaction((tx) =>
                Documents.publishInTransaction(tx, { ...input, instruction: 'Different' })
              )
            )).kind,
            'invalid_input'
          );
        }).pipe(Effect.provide(f.services))
      );
      assert.equal(
        f.context.db.orm.get(sql`SELECT count(*) AS n FROM study_document_generation_requests`)?.n,
        2n
      );
      assert.equal(
        f.context.db.orm.get(sql`SELECT count(*) AS n FROM study_document_proposals`)?.n,
        1n
      );
    } finally {
      f.close();
    }
  }
);

testStable(
  'exact citations, Unicode annotation history, image pins and inherited retired message identities are validated',
  async () => {
    const f = fixture();

    try {
      f.context.db
        .exec(`INSERT INTO sources(id,origin,kind,mime,name,size_bytes,sha256,created_at) VALUES(8,'attachment','image','image/png','Image',1,zeroblob(32),1);
   INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime) VALUES(8,1,X'41','image','image/png');
   INSERT INTO sessions(id,title,title_source,created_at,updated_at) VALUES(1,'Session','user',1,1);
   INSERT INTO messages(id,session_id,role,created_at) VALUES(10,1,'user',1);
   INSERT INTO message_versions(id,message_id,number,origin,status,text,created_at) VALUES(11,10,1,'typed','complete','Exact raw',1);`);
      const ids = await import('@study/contracts/ids');

      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Documents;
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

          assert.ok(a.version);
          assert.equal(
            f.context.db.orm.get(
              sql`SELECT count(*) AS n FROM document_assets WHERE document_id=${a.version.snapshotId}`
            )?.n,
            1n
          );
          const target = {
            documentId: a.id,
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

          assert.equal(annotation.outcome, 'saved');
          const invalid = yield* Effect.flip(
            docs.createAnnotation({
              target: { ...target, range: { ...target.range, start: 2 } },
              kind: 'note',
              note: 'Split surrogate'
            })
          );

          assert.equal(invalid.kind, 'invalid_input');
          const updated = yield* docs.reviseAnnotation({
            id: annotation.annotation.id,
            expectedRevision: 1n,
            target,
            kind: 'note',
            note: 'Revised',
            deleted: false
          });

          assert.equal(updated.annotation.revision, 2n);
          const stale = yield* docs.reviseAnnotation({
            id: annotation.annotation.id,
            expectedRevision: 1n,
            target,
            kind: 'note',
            note: 'Stale',
            deleted: false
          });

          assert.equal(stale.outcome, 'conflict');
          assert.equal(
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
            documentId: a.id,
            versionId: a.version.id,
            limit: 1,
            includeDeleted: false
          });

          assert.equal(firstAnnotations.items[0].id, extra.annotation.id);
          assert.equal(firstAnnotations.nextCursor, extra.annotation.id);
          const nextAnnotations = yield* docs.annotations({
            documentId: a.id,
            limit: 1,
            cursor: firstAnnotations.nextCursor!,
            includeDeleted: false
          });

          assert.equal(nextAnnotations.items[0].note, 'Revised');
          assert.equal(nextAnnotations.items[0].revision, 2n);
          assert.equal(nextAnnotations.nextCursor, null);
          yield* docs.reviseAnnotation({
            id: extra.annotation.id,
            expectedRevision: 1n,
            target,
            kind: 'note',
            note: 'Retained tombstone',
            deleted: true
          });
          assert.equal(
            (yield* docs.annotations({ documentId: a.id, limit: 10, includeDeleted: false })).items
              .length,
            1
          );
          assert.equal(
            (yield* docs.annotations({ documentId: a.id, limit: 10, includeDeleted: true })).items
              .length,
            2
          );
          const input = { kind: 'document' as const, versionId: a.version.id };
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

          assert.ok(cited.version);
          assert.equal(
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
            )).kind,
            'invalid_input'
          );
          const messageInput = {
            kind: 'message' as const,
            versionId: Schema.decodeUnknownSync(ids.versionIdSchema)(11n)
          };
          const derived = yield* docs.create({
            ...creation('raw-derived'),
            inputs: [messageInput]
          });

          assert.ok(derived.version);
          f.context.db.exec('DELETE FROM sessions WHERE id=1');
          const changed = yield* docs.save({
            documentId: derived.id,
            expectedVersionId: derived.version.id,
            key: 'after-session',
            document: body('Still editable', derived.version.document.blocks[0].id)
          });

          assert.equal(changed.outcome, 'saved');
          assert.deepEqual((yield* docs.version({ id: changed.submittedVersionId })).inputs, [
            messageInput
          ]);
        }).pipe(Effect.provide(f.services))
      );
      assert.throws(() =>
        f.context.db.exec(
          `UPDATE source_snapshots SET bytes=X'42' WHERE source_id=8 AND revision=1`
        )
      );
      assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
    } finally {
      f.close();
    }
  }
);

testStable(
  'independent generated publication owns the first authored version and replays one typed request',
  async () => {
    const f = fixture();

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
          const a = yield* transaction((tx) => Documents.createGeneratedInTransaction(tx, request));

          assert.ok(a.version);
          assert.equal(a.version.creator, 'agent');
          assert.equal(a.version.operation, 'generate');
          assert.equal(a.version.number, 1n);
          assert.deepEqual(a.version.parents, []);
          assert.equal(a.version.instruction, request.instruction);
          const docs = yield* Documents;

          yield* docs.save({
            documentId: a.documentId,
            expectedVersionId: a.version.id,
            key: 'later-edit',
            document: body('Later authored edit', a.version.document.blocks[0].id)
          });
          const replay = yield* transaction((tx) =>
            Documents.createGeneratedInTransaction(tx, request)
          );

          assert.equal(replay.documentId, a.documentId);
          assert.equal(replay.version.id, a.version.id);
          assert.equal(replay.replayed, true);
          assert.equal(
            (yield* Effect.flip(
              transaction((tx) =>
                Documents.createGeneratedInTransaction(tx, {
                  ...request,
                  instruction: 'Different intent'
                })
              )
            )).kind,
            'invalid_input'
          );
          const receipt = f.context.db.orm.get(
            sql`SELECT expected_version_id,result_version_id FROM study_document_generation_requests WHERE id='independent-generation'`
          );

          assert.equal(receipt?.expected_version_id, null);
          assert.equal(receipt?.result_version_id, a.version.id);
        }).pipe(Effect.provide(f.services))
      );
      assert.equal(f.context.db.orm.get(sql`SELECT count(*) AS n FROM materials`)?.n, 0n);
      assert.equal(
        f.context.db.orm.get(sql`SELECT count(*) AS n FROM study_document_versions`)?.n,
        2n
      );
      assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
    } finally {
      f.close();
    }
  }
);

testStable(
  'authored metadata and target proposals retain independent histories and exact replay',
  async () => {
    const f = fixture();

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Documents;
          const created = yield* docs.create(creation('proposal-target'));
          const base = created.version!;
          const metadata = yield* docs.updateMetadata({
            id: created.id,
            title: 'Renamed document',
            description: 'Private description',
            expectedTitle: created.title,
            expectedDescription: created.description
          });

          assert.equal(metadata.title, 'Renamed document');
          assert.equal(metadata.description, 'Private description');
          assert.equal(metadata.headVersionId, base.id);
          const proposalInput = {
            requestId: 'target-proposal',
            documentId: created.id,
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
            Documents.proposeGeneratedInTransaction(tx, proposalInput)
          );

          assert.equal(proposed.baseVersionId, base.id);
          assert.equal((yield* docs.document({ id: created.id })).headVersionId, base.id);
          assert.equal((yield* docs.version({ id: proposed.proposedVersionId })).status, 'draft');
          assert.deepEqual(
            yield* transaction((tx) => Documents.proposeGeneratedInTransaction(tx, proposalInput)),
            proposed
          );
          const changed = yield* docs.save({
            documentId: created.id,
            expectedVersionId: base.id,
            key: 'concurrent',
            document: body('Concurrent text', base.document.blocks[0].id)
          });
          const conflict = yield* docs.applyProposal({
            requestId: proposed.requestId,
            key: 'apply-stale',
            expectedVersionId: base.id
          });

          assert.equal(conflict.outcome, 'conflict');
          assert.equal(conflict.currentVersionId, changed.submittedVersionId);
          const keepInput = {
            requestId: proposed.requestId,
            key: 'keep-separate',
            title: 'Alternative'
          };
          const kept = yield* docs.keepProposal(keepInput);

          assert.equal(kept.outcome, 'kept');
          assert.equal((yield* docs.keepProposal(keepInput)).replayed, true);
          const alternative = yield* docs.version({ id: kept.resultVersionId! });

          assert.notEqual(alternative.documentId, created.id);
          assert.equal(alternative.document.blocks[0].text, 'Proposed text');
          assert.notEqual(alternative.document.blocks[0].id, base.document.blocks[0].id);
          assert.equal(
            (yield* docs.document({ id: created.id })).headVersionId,
            changed.submittedVersionId
          );
          assert.equal(
            (yield* Effect.flip(
              docs.applyProposal({
                requestId: proposed.requestId,
                key: 'apply-current',
                expectedVersionId: changed.submittedVersionId
              })
            )).kind,
            'invalid_input'
          );
          const target = yield* docs.create(creation('fresh-proposal-target'));
          const fresh = yield* transaction((tx) =>
            Documents.proposeGeneratedInTransaction(tx, {
              ...proposalInput,
              documentId: target.id,
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

          assert.equal(applied.outcome, 'applied');
          assert.equal(
            (yield* docs.document({ id: target.id })).headVersionId,
            applied.resultVersionId
          );
          assert.equal(
            (yield* docs.version({ id: applied.resultVersionId! })).document.blocks[0].text,
            'Accepted proposal'
          );
          const replay = yield* docs.applyProposal(applyInput);

          assert.equal(replay.replayed, true);
          assert.equal(replay.resultVersionId, applied.resultVersionId);
          const retirement = yield* docs.previewDeletion({ id: target.id });

          assert.deepEqual(
            retirement.blockedVersionIds,
            [],
            'Own proposal identities do not retain deleted document bodies'
          );
          yield* docs.delete({ documentId: target.id, token: retirement.token });
          assert.equal((yield* Effect.flip(docs.document({ id: target.id }))).kind, 'not_found');
          assert.equal((yield* docs.applyProposal(applyInput)).replayed, true);

          assert.equal(
            (yield* Effect.flip(
              docs.updateMetadata({
                id: created.id,
                title: 'Overwritten',
                description: null,
                expectedTitle: created.title,
                expectedDescription: created.description
              })
            )).kind,
            'invalid_input'
          );
        }).pipe(Effect.provide(f.services))
      );
    } finally {
      f.close();
    }
  }
);

testStable(
  'history pagination follows logical numbers when exact version IDs have a different order',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Documents;
          const owner = yield* docs.create(creation('logical-order'));

          assert.ok(owner.version);
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
              sql`INSERT INTO study_document_versions(id,document_id,number,content_snapshot_id,created_at) VALUES(${id},${owner.id},${number},${snapshot.id},1)`
            );
          }

          const first = yield* docs.versions({ documentId: owner.id, limit: 1 });

          assert.equal(first.items[0]?.number, 3n);
          assert.equal(first.items[0]?.id, 50n);
          assert.equal(first.nextCursor, 50n);
          const second = yield* docs.versions({
            documentId: owner.id,
            limit: 1,
            cursor: first.nextCursor!
          });

          assert.equal(second.items[0]?.number, 2n);
          assert.equal(second.items[0]?.id, 100n);
          const last = yield* docs.versions({
            documentId: owner.id,
            limit: 1,
            cursor: second.nextCursor!
          });

          assert.equal(last.items[0]?.id, owner.version.id);
          assert.equal(last.nextCursor, null);
        }).pipe(
          Effect.provide(Documents.layer),
          Effect.provideService(Database, { store: context })
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
