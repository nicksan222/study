/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises authored Document annotations behavior through real persistence          │
 * │ boundaries.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies standalone authored annotation CRUD preserves exact rich Unicode history,     │
 * │   conflicts, outbox atomicity and reopen.                                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import { annotationSchema } from '@study/contracts/documents/evidence';
import { DocumentsRpc } from '@study/contracts/documents/rpc';
import { contentSnapshotIdSchema, studyDocumentVersionIdSchema } from '@study/contracts/ids';
import { correctBlockText, createBlock } from '@study/contracts/sources/document';
import { sql, eq } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Documents } from '#server/features/documents/index';
import { DocumentsRpcLive } from '#server/features/documents/rpc/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

const meta = {
  extractor: null,
  extractorVersion: 1,
  provider: null,
  durationMs: null,
  pageCount: null,
  refiners: [],
  waitingFor: [],
  corrected: false,
  omissions: []
};

const paragraph = (text: string) =>
  createBlock({ type: 'paragraph', inlines: [{ type: 'text', text, marks: ['strong'] }] });

testStable(
  'standalone authored annotation CRUD preserves exact rich Unicode history, conflicts, outbox atomicity and reopen',
  async () => {
    const location = createTestDatabase();
    let context = new ServerContext(location.open());
    const handlers = () =>
      DocumentsRpcLive.pipe(
        Layer.provideMerge(Documents.layer),
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );
    const state = () => ({
      heads: context.db.orm.select().from(s.study_document_annotations).all(),
      revisions: context.db.orm.select().from(s.study_document_annotation_revisions).all(),
      events: context.db.orm
        .select()
        .from(s.workflowEvents)
        .all()
        .filter((event) => event.type === 'DocumentAnnotationChanged')
    });

    try {
      const retained = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(DocumentsRpc);
            const block = paragraph('A😀B rich');
            const document = yield* rpc['documents.create']({
              createKey: randomUUID(),
              title: 'Standalone',
              document: { blocks: [block], meta },
              inputs: [],
              citations: []
            });

            assert.ok(document.version);
            const target = {
              documentId: document.id,
              range: {
                versionId: document.version.id,
                snapshotId: document.version.snapshotId,
                blockId: block.id,
                start: 1,
                end: 3
              }
            };
            const created = yield* rpc['documents.createAnnotation']({
              target,
              kind: 'highlight',
              note: ''
            });

            assert.ok(created.outcome === 'saved');
            const exact = yield* rpc['documents.version']({
              id: created.annotation.target.range.versionId
            });

            expect(exact.document.blocks[0].content).toStrictEqual(block.content);
            assert.ok(
              exact.document.blocks[0].text.slice(target.range.start, target.range.end) === '😀'
            );
            const id = created.annotation.id;

            for (const range of [
              { ...target.range, end: 2 },
              { ...target.range, end: 200 },
              { ...target.range, start: 1, end: 1 }
            ])
              assert.ok(
                (yield* Effect.flip(
                  rpc['documents.createAnnotation']({
                    target: { ...target, range },
                    kind: 'note',
                    note: 'Invalid'
                  })
                )).kind === 'invalid_input'
              );

            const update = {
              id,
              expectedRevision: 1n,
              target,
              kind: 'note' as const,
              note: 'First edit',
              deleted: false
            };

            assert.ok((yield* rpc['documents.reviseAnnotation'](update)).outcome === 'saved');
            const beforeConflicts = state();

            for (const intent of [
              { ...update, note: 'Lost edit' },
              { ...update, target: { ...target, range: { ...target.range, start: 3, end: 4 } } },
              { ...update, deleted: true }
            ]) {
              const conflict = yield* rpc['documents.reviseAnnotation'](intent);

              assert.ok(conflict.outcome === 'conflict');
              assert.ok(conflict.annotation.note === 'First edit');
              expect(conflict.annotation.target).toStrictEqual(target);
            }

            assert.ok(
              (yield* Effect.flip(
                rpc['documents.reviseAnnotation']({
                  ...update,
                  expectedRevision: 2n,
                  target: { ...target, range: { ...target.range, end: 200 } }
                })
              )).kind === 'invalid_input'
            );
            expect(state()).toStrictEqual(beforeConflicts);
            const other = yield* rpc['documents.create']({
              createKey: randomUUID(),
              title: 'Other identity',
              document: { blocks: [paragraph('A😀B rich')], meta },
              inputs: [],
              citations: []
            });

            assert.ok(other.version);
            const beforeWrongOwner = state();

            assert.ok(
              (yield* Effect.flip(
                rpc['documents.reviseAnnotation']({
                  ...update,
                  expectedRevision: 2n,
                  target: { ...target, documentId: other.id }
                })
              )).kind === 'invalid_input'
            );
            expect(state()).toStrictEqual(beforeWrongOwner);
            const changed = yield* rpc['documents.save']({
              documentId: document.id,
              expectedVersionId: document.version.id,
              key: 'annotation-edit',
              document: { blocks: [correctBlockText(block, 'Changed text')], meta }
            });
            const changedVersion = yield* rpc['documents.version']({
              id: changed.submittedVersionId
            });
            const nextTarget = {
              documentId: document.id,
              range: {
                versionId: changedVersion.id,
                snapshotId: changedVersion.snapshotId,
                blockId: block.id,
                start: 0,
                end: 7
              }
            };
            const moved = yield* rpc['documents.reviseAnnotation']({
              ...update,
              expectedRevision: 2n,
              target: nextTarget
            });

            assert.ok(moved.annotation.operation === 'reanchor');
            expect(
              (yield* rpc['documents.annotationHistory']({ id, limit: 10 })).items.map(
                (item) => item.target
              )
            ).toStrictEqual([nextTarget, target, target]);
            assert.ok(
              (yield* rpc['documents.version']({
                id: target.range.versionId
              })).document.blocks[0].text.slice(1, 3) === '😀'
            );
            const beforeFailure = state();

            context.db.exec(
              "CREATE TRIGGER reject_annotation_event BEFORE INSERT ON workflow_events WHEN NEW.type='DocumentAnnotationChanged' BEGIN SELECT RAISE(ABORT,'injected outbox failure'); END"
            );

            for (const intent of [
              { ...update, expectedRevision: 3n, target: nextTarget, note: 'Rolled back' },
              { ...update, expectedRevision: 3n, target },
              { ...update, expectedRevision: 3n, target: nextTarget, deleted: true }
            ]) {
              yield* Effect.flip(rpc['documents.reviseAnnotation'](intent));
              expect(state()).toStrictEqual(beforeFailure);
            }

            context.db.exec('DROP TRIGGER reject_annotation_event');
            const foreign = {
              ...moved.annotation,
              revision: 4n,
              target: {
                documentId: other.id,
                range: {
                  ...target.range,
                  versionId: other.version.id,
                  snapshotId: other.version.snapshotId,
                  blockId: other.version.document.blocks[0].id
                }
              }
            };

            assert.throws(() =>
              context.db.orm
                .insert(s.study_document_annotation_revisions)
                .values({
                  annotation_id: id,
                  revision: 4n,
                  document_id: other.id,
                  version_id: other.version!.id,
                  snapshot_id: other.version!.snapshotId,
                  payload: Schema.encodeSync(
                    Schema.fromJsonString(Schema.toCodecJson(annotationSchema))
                  )(foreign)
                })
                .run()
            );
            assert.throws(() => context.db.orm.delete(s.study_document_annotations).run());
            assert.throws(() =>
              context.db.orm.update(s.study_document_annotations).set({ revision: 9n }).run()
            );
            assert.throws(() =>
              context.db.orm
                .update(s.study_document_annotations)
                .set({ document_id: other.id })
                .where(eq(s.study_document_annotations.id, id))
                .run()
            );
            assert.throws(() => context.db.orm.delete(s.study_document_annotation_revisions).run());
            assert.throws(() =>
              context.db.orm
                .update(s.study_document_annotation_revisions)
                .set({ payload: '{}' })
                .run()
            );
            expect(state()).toStrictEqual(beforeFailure);
            const retried = yield* rpc['documents.reviseAnnotation']({
              ...update,
              expectedRevision: 3n,
              target: nextTarget,
              note: 'Retried after rollback'
            });

            assert.strictEqual(retried.annotation.revision, 4n);
            assert.strictEqual(state().events.length, beforeFailure.events.length + 1);
            const page = yield* rpc['documents.annotationHistory']({ id, limit: 2 });

            expect(page.items.map((item) => item.revision)).toStrictEqual([4n, 3n]);
            assert.strictEqual(page.nextCursor, 3n);
            const tail = yield* rpc['documents.annotationHistory']({
              id,
              limit: 2,
              cursor: page.nextCursor!
            });

            expect(tail.items.map((item) => item.revision)).toStrictEqual([2n, 1n]);
            assert.ok(tail.nextCursor === null);
            assert.strictEqual(
              (yield* rpc['documents.annotations']({
                documentId: document.id,
                limit: 1,
                includeDeleted: false
              })).items.length,
              1
            );

            return { id, documentId: document.id, target, nextTarget };
          }).pipe(Effect.provide(handlers()))
        )
      );

      context.close();
      context = new ServerContext(location.open());
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(DocumentsRpc);
            const reopened = yield* rpc['documents.annotation']({ id: retained.id });

            assert.strictEqual(reopened.revision, 4n);
            assert.ok(reopened.note === 'Retried after rollback');
            const deleted = yield* rpc['documents.reviseAnnotation']({
              id: retained.id,
              expectedRevision: reopened.revision,
              target: reopened.target,
              kind: reopened.kind,
              note: reopened.note,
              deleted: true
            });

            assert.ok(deleted.annotation.deleted === true);
            assert.strictEqual(deleted.annotation.revision, 5n);
            assert.strictEqual(
              (yield* rpc['documents.annotations']({
                documentId: retained.documentId,
                limit: 10,
                includeDeleted: false
              })).items.length,
              0
            );
            assert.strictEqual(
              (yield* rpc['documents.annotations']({
                documentId: retained.documentId,
                limit: 10,
                includeDeleted: true
              })).items.length,
              1
            );
            assert.strictEqual(
              (yield* rpc['documents.annotationHistory']({ id: retained.id, limit: 10 })).items
                .length,
              5
            );
            assert.strictEqual(
              (yield* rpc['documents.document']({ id: retained.documentId })).id,
              retained.documentId
            );
            const tombstone = state();

            for (const intent of [
              { target: reopened.target, deleted: false, note: 'No resurrection' },
              { target: retained.target, deleted: false, note: reopened.note },
              { target: reopened.target, deleted: true, note: reopened.note }
            ])
              assert.ok(
                (yield* Effect.flip(
                  rpc['documents.reviseAnnotation']({
                    id: retained.id,
                    expectedRevision: 5n,
                    kind: 'note',
                    ...intent
                  })
                )).kind === 'invalid_input'
              );

            expect(state()).toStrictEqual(tombstone);
            assert.ok(
              (yield* Effect.flip(
                rpc['documents.version']({ id: studyDocumentVersionIdSchema.make(999999n) })
              )).kind === 'not_found'
            );

            for (const range of [
              { ...retained.target.range, snapshotId: contentSnapshotIdSchema.make(999999n) },
              { ...retained.target.range, blockId: paragraph('Missing').id },
              { ...retained.target.range, start: 2, end: 3 },
              { ...retained.target.range, start: 1, end: 1 }
            ])
              assert.ok(
                (yield* Effect.flip(
                  rpc['documents.createAnnotation']({
                    target: { ...retained.target, range },
                    kind: 'note',
                    note: ''
                  })
                )).kind === 'invalid_input'
              );

            const old = yield* rpc['documents.version']({ id: retained.target.range.versionId });

            assert.ok(old.document.blocks[0].text.slice(1, 3) === '😀');
            expect(context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
          }).pipe(Effect.provide(handlers()))
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
