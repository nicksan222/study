/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises historic evidence and annotation behavior through SQLite and native RPC. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Authors Unicode, conflict, retention and support invalidation regression cases.        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Execution is UNRUN pending CI; fixtures use real migrated SQLite databases.              │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { documentIdSchema, materialVersionIdSchema } from '@study/contracts/ids';
import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { createBlock, correctBlockText } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Materials } from '#server/features/materials/index';
import { MaterialsRpcLive } from '#server/features/materials/rpc/index';
import { MaterialsStore } from '#server/features/materials/store/index';
import { Sources } from '#server/features/sources/index';
import { SourceStore } from '#server/features/sources/store/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';

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

function paragraph(text: string) {
  return createBlock({ type: 'paragraph', inlines: [{ type: 'text', text, marks: ['strong'] }] });
}

function handlers(context: ServerContext) {
  return MaterialsRpcLive.pipe(
    Layer.provideMerge(Layer.mergeAll(Materials.layer, Sources.layer)),
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );
}

test('standalone annotation CRUD preserves exact rich Unicode history, conflicts, outbox atomicity and reopen', async () => {
  const location = createTestDatabase();
  let context = new ServerContext(location.open());

  try {
    const retained = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
          const materials = yield* Materials;
          const block = paragraph('A😀B rich');
          const material = yield* rpc('materials.createManualDocument', {
            title: 'Standalone',
            document: { blocks: [block], meta }
          });
          const documentId = context.db.orm
            .select()
            .from(s.material_document_versions)
            .where(eq(s.material_document_versions.version_id, material.version.id))
            .get()!.document_id;
          const target = {
            materialId: material.id,
            range: {
              versionId: material.version.id,
              documentId,
              blockId: block.id,
              start: 1,
              end: 3
            }
          };
          const created = yield* rpc('materials.createAnnotation', {
            target,
            kind: 'highlight',
            note: ''
          });

          assert.equal(created.outcome, 'saved');
          if (created.outcome !== 'saved') throw new Error('Expected saved annotation');

          assert.equal(created.annotation.evidence.availability, 'available');
          if (created.annotation.evidence.availability === 'available') {
            assert.equal(created.annotation.evidence.excerpt, '😀');
            assert.deepEqual(created.annotation.evidence.block?.content, block.content);
            assert.equal(created.annotation.evidence.locationPrecision, 'unavailable');
          }
          const split = yield* rpc('materials.createAnnotation', {
            target: { ...target, range: { ...target.range, end: 2 } },
            kind: 'highlight',
            note: ''
          });

          assert.equal(split.outcome, 'unavailable');
          const invalid = yield* rpc('materials.createAnnotation', {
            target: { ...target, range: { ...target.range, end: 200 } },
            kind: 'note',
            note: 'invalid'
          });

          assert.equal(invalid.outcome, 'unavailable');
          const updated = yield* rpc('materials.updateAnnotation', {
            id: created.annotation.id,
            expectedRevision: 1n,
            kind: 'note',
            note: 'First edit'
          });

          assert.equal(updated.outcome, 'saved');
          const staleNote = yield* rpc('materials.updateAnnotation', {
            id: created.annotation.id,
            expectedRevision: 1n,
            kind: 'note',
            note: 'Lost edit'
          });

          assert.equal(staleNote.outcome, 'conflict');
          const unavailableMove = yield* rpc('materials.reanchorAnnotation', {
            id: created.annotation.id,
            expectedRevision: 2n,
            target: { ...target, range: { ...target.range, end: 200 } }
          });

          assert.equal(unavailableMove.outcome, 'unavailable');
          assert.deepEqual(
            (yield* rpc('materials.annotation', { id: created.annotation.id })).target,
            target
          );

          const conflict = yield* rpc('materials.reanchorAnnotation', {
            id: created.annotation.id,
            expectedRevision: 1n,
            target: { ...target, range: { ...target.range, start: 3, end: 4 } }
          });

          assert.equal(conflict.outcome, 'conflict');
          if (conflict.outcome === 'conflict') {
            assert.equal(conflict.current.note, 'First edit');
            assert.deepEqual(conflict.current.target, target);
            assert.ok('target' in conflict.submitted);
          }
          const changed = yield* rpc('materials.saveDocument', {
            materialId: material.id,
            expectedVersionId: material.version.id,
            saveKey: 'annotation-edit',
            document: { blocks: [correctBlockText(block, 'Changed text')], meta }
          });
          const nextDocumentId = context.db.orm
            .select()
            .from(s.material_document_versions)
            .where(eq(s.material_document_versions.version_id, changed.submittedVersionId))
            .get()!.document_id;
          const nextTarget = {
            materialId: material.id,
            range: {
              versionId: changed.submittedVersionId,
              documentId: nextDocumentId,
              blockId: block.id,
              start: 0,
              end: 7
            }
          };
          const moved = yield* rpc('materials.reanchorAnnotation', {
            id: created.annotation.id,
            expectedRevision: 2n,
            target: nextTarget
          });

          assert.equal(moved.outcome, 'saved');
          assert.deepEqual(
            (yield* rpc('materials.annotationHistory', {
              id: created.annotation.id,
              limit: 10
            })).items.map((r) => r.target),
            [target, target, nextTarget]
          );
          assert.equal(
            (yield* rpc('materials.resolveEvidence', { kind: 'range', target })).availability,
            'available'
          );
          const before = context.db.orm.select().from(s.material_annotation_revisions).all();
          const outboxBefore = context.db.orm.select().from(s.workflowEvents).all();

          context.db.orm.run(
            sql.raw(
              "CREATE TRIGGER reject_annotation_event BEFORE INSERT ON workflow_events WHEN NEW.type = 'MaterialAnnotationChanged' BEGIN SELECT RAISE(ABORT, 'injected outbox failure'); END"
            )
          );
          yield* Effect.flip(
            materials.updateAnnotation({
              id: created.annotation.id,
              expectedRevision: 3n,
              kind: 'note',
              note: 'Rolled back'
            })
          );
          assert.deepEqual(
            context.db.orm.select().from(s.material_annotation_revisions).all(),
            before
          );
          assert.deepEqual(context.db.orm.select().from(s.workflowEvents).all(), outboxBefore);
          assert.equal(
            (yield* rpc('materials.annotation', { id: created.annotation.id })).revision,
            3n
          );
          context.db.orm.run(sql.raw('DROP TRIGGER reject_annotation_event'));

          assert.throws(() => context.db.orm.delete(s.material_annotation_revisions).run());
          assert.throws(() =>
            context.db.orm.update(s.material_annotation_revisions).set({ payload: '{}' }).run()
          );
          const page = yield* rpc('materials.annotations', { materialId: material.id, limit: 1 });

          assert.equal(page.items.length, 1);
          return { id: created.annotation.id, materialId: material.id, target };
        }).pipe(Effect.provide(handlers(context)))
      )
    );

    context.close();
    context = new ServerContext(location.open());
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
          const reopened = yield* rpc('materials.annotation', { id: retained.id });

          assert.equal(reopened.revision, 3n);
          assert.equal(reopened.note, 'First edit');
          assert.equal(
            (yield* rpc('materials.deleteAnnotation', { id: retained.id, expectedRevision: 3n }))
              .outcome,
            'saved'
          );
          assert.equal(
            (yield* rpc('materials.annotations', { materialId: retained.materialId, limit: 10 }))
              .items.length,
            0
          );
          assert.equal(
            (yield* rpc('materials.annotationHistory', { id: retained.id, limit: 10 })).items
              .length,
            4
          );
          assert.equal(
            (yield* rpc('materials.material', { id: retained.materialId })).id,
            retained.materialId
          );
          const missing = yield* rpc('materials.resolveEvidence', {
            kind: 'range',
            target: {
              ...retained.target,
              range: {
                ...retained.target.range,
                versionId: Schema.decodeUnknownSync(materialVersionIdSchema)(999999n)
              }
            }
          });

          assert.equal(missing.availability, 'unavailable');
          const mismatch = yield* rpc('materials.resolveEvidence', {
            kind: 'range',
            target: {
              ...retained.target,
              range: {
                ...retained.target.range,
                documentId: Schema.decodeUnknownSync(documentIdSchema)(999999n)
              }
            }
          });

          assert.equal(mismatch.availability, 'unavailable');
          const old = yield* rpc('materials.resolveEvidence', {
            kind: 'range',
            target: retained.target
          });

          assert.equal(old.availability, 'available');
          if (old.availability === 'available') assert.equal(old.excerpt, '😀');
        }).pipe(Effect.provide(handlers(context)))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('user support is pinned to both rich ranges; claim edit, citation copy and undo never inherit it', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
          const evidenceBlock = paragraph('Exact evidence');
          const input = yield* rpc('materials.createManualDocument', {
            title: 'Evidence',
            document: { blocks: [evidenceBlock], meta }
          });
          const evidenceDocument = context.db.orm
            .select()
            .from(s.material_document_versions)
            .where(eq(s.material_document_versions.version_id, input.version.id))
            .get()!.document_id;
          const evidence = {
            materialId: input.id,
            range: {
              versionId: input.version.id,
              documentId: evidenceDocument,
              blockId: evidenceBlock.id,
              start: 0,
              end: evidenceBlock.text.length
            }
          };
          const claimBlock = paragraph('Claim [1]');
          const claim = yield* rpc('materials.create', {
            title: 'Claim',
            content: { kind: 'document', blocks: [claimBlock], meta },
            inputs: [input.version.id],
            publish: false
          });

          yield* rpc('materials.setCitations', {
            id: claim.version.id,
            citations: [
              {
                marker: 1n,
                inputVersionId: input.version.id,
                target: evidence.range,
                anchor: { type: 'authored' },
                quote: 'Exact evidence'
              }
            ]
          });
          yield* rpc('materials.publishVersion', { id: claim.version.id });
          const claimDocument = context.db.orm
            .select()
            .from(s.material_document_versions)
            .where(eq(s.material_document_versions.version_id, claim.version.id))
            .get()!.document_id;
          const target = {
            materialId: claim.id,
            range: {
              versionId: claim.version.id,
              documentId: claimDocument,
              blockId: claimBlock.id,
              start: 0,
              end: claimBlock.text.length
            }
          };

          assert.equal(
            (yield* rpc('materials.citationSupport', { versionId: claim.version.id, marker: 1n }))
              .state,
            'unassessed'
          );
          const assessed = yield* rpc('materials.assessCitation', {
            claim: target,
            evidence,
            marker: 1n,
            judgment: 'supports',
            note: 'My judgment'
          });

          assert.equal(assessed.state, 'assessed');
          if (assessed.state !== 'unassessed') {
            assert.equal(assessed.assessment.independentVerification, false);
            assert.equal(assessed.assessment.suppliedBy, 'user');
          }
          assert.equal(
            (yield* rpc('materials.citations', { id: claim.version.id, limit: 10 })).items[0]
              ?.support?.state,
            'assessed'
          );
          const changed = yield* rpc('materials.saveDocument', {
            materialId: claim.id,
            expectedVersionId: claim.version.id,
            saveKey: 'claim-edit',
            document: { blocks: [correctBlockText(claimBlock, 'Changed claim [1]')], meta }
          });
          const stale = yield* rpc('materials.citationSupport', {
            versionId: claim.version.id,
            marker: 1n
          });

          assert.equal(stale.state, 'stale');
          if (stale.state !== 'unassessed') {
            assert.ok(stale.reasons.includes('claim_changed'));
            assert.equal(stale.claim.availability, 'available');
            assert.deepEqual(stale.assessment.claim, target);
          }
          assert.equal(
            (yield* rpc('materials.citationSupport', {
              versionId: changed.submittedVersionId,
              marker: 1n
            })).state,
            'unassessed'
          );
          const copied = (yield* rpc('materials.citations', {
            id: changed.submittedVersionId,
            limit: 10
          })).items[0]!;

          assert.deepEqual(copied.target, evidence.range);
          assert.equal(copied.quote, 'Exact evidence');
          assert.equal(copied.support?.state, 'unassessed');
          const undo = yield* rpc('materials.undoDocument', {
            materialId: claim.id,
            expectedVersionId: changed.submittedVersionId,
            restoreVersionId: claim.version.id,
            undoKey: 'claim-undo'
          });

          assert.equal(
            (yield* rpc('materials.citationSupport', {
              versionId: undo.submittedVersionId,
              marker: 1n
            })).state,
            'unassessed'
          );
          const editedEvidence = yield* rpc('materials.saveDocument', {
            materialId: input.id,
            expectedVersionId: input.version.id,
            saveKey: 'evidence-edit',
            document: { blocks: [correctBlockText(evidenceBlock, 'Revised evidence')], meta }
          });
          const staleBoth = yield* rpc('materials.citationSupport', {
            versionId: claim.version.id,
            marker: 1n
          });

          assert.equal(staleBoth.state, 'stale');
          if (staleBoth.state !== 'unassessed')
            assert.ok(staleBoth.reasons.includes('evidence_changed'));
          const dependents = yield* rpc('materials.dependencyStatus', {
            id: input.version.id,
            limit: 10
          });

          assert.ok(
            dependents.items.some(
              (row) =>
                row.dependentVersionId === claim.version.id &&
                row.inputVersionId === input.version.id &&
                row.currentVersionId === editedEvidence.submittedVersionId &&
                row.state === 'stale'
            )
          );
          assert.throws(() => context.db.orm.delete(s.material_citation_assessments).run());
          assert.equal(
            context.db.orm.select().from(s.material_citation_assessments).all().length,
            1
          );
          assert.deepEqual(
            (yield* rpc('materials.materialVersion', { id: claim.version.id })).inputs,
            [input.version.id]
          );
        }).pipe(Effect.provide(handlers(context)))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('source correction and replacement preserve exact historic navigation and expose current dependency identities', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const sources = yield* Sources;
          const materials = yield* Materials;
          const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
          const source = yield* sources.createSource({
            name: 'source.txt',
            projectId: null,
            bytes: new TextEncoder().encode('A😀B original')
          });
          const state = yield* sources.sourceProcessing(source.id);
          const block = createBlock(
            { type: 'paragraph', inlines: [{ type: 'text', text: 'A😀B original', marks: [] }] },
            { type: 'text', lineStart: 0, lineEnd: 0, start: 0, end: 15 }
          );
          const document = { blocks: [block], meta };
          const first = yield* transaction((tx) =>
            tx.store(SourceStore).publishSourceDocument({
              id: source.id,
              expectedRevision: 1,
              requestId: state.requestId!,
              document
            })
          );
          const project = (documentId: typeof first.documentId, eventId: string) =>
            transaction((tx) =>
              tx.store(MaterialsStore).projectSource({
                type: 'SourceIndexed',
                sourceId: source.id,
                projectId: null,
                documentId,
                inputVersion: 1,
                eventId,
                correlationId: eventId,
                causationId: null,
                depth: 0
              })
            );
          const projected = yield* project(first.documentId, 'initial-evidence');
          const target = {
            materialId: projected.extracted.id,
            range: {
              versionId: projected.extracted.version.id,
              documentId: first.documentId,
              blockId: block.id,
              start: 1,
              end: 3
            }
          };
          const annotation = yield* rpc('materials.createAnnotation', {
            target,
            kind: 'highlight',
            note: 'historic'
          });
          const claimBlock = paragraph('Independent [1]');
          const derived = yield* rpc('materials.create', {
            title: 'Derivative',
            content: { kind: 'document', blocks: [claimBlock], meta },
            inputs: [projected.extracted.version.id],
            publish: false
          });

          yield* rpc('materials.setCitations', {
            id: derived.version.id,
            citations: [
              {
                marker: 1n,
                inputVersionId: projected.extracted.version.id,
                target: target.range,
                anchor: block.anchor,
                quote: '😀'
              }
            ]
          });
          yield* rpc('materials.publishVersion', { id: derived.version.id });
          const claimDocumentId = context.db.orm
            .select()
            .from(s.material_document_versions)
            .where(eq(s.material_document_versions.version_id, derived.version.id))
            .get()!.document_id;
          const judgment = yield* rpc('materials.assessCitation', {
            claim: {
              materialId: derived.id,
              range: {
                versionId: derived.version.id,
                documentId: claimDocumentId,
                blockId: claimBlock.id,
                start: 0,
                end: claimBlock.text.length
              }
            },
            evidence: target,
            marker: 1n,
            judgment: 'supports',
            note: 'User assessment of old extraction'
          });

          assert.equal(judgment.state, 'assessed');
          const correction = yield* sources.correctBlock({
            id: source.id,
            documentId: first.documentId,
            ordinal: 0,
            before: block.text,
            after: 'Corrected extraction'
          });
          const corrected = yield* transaction((tx) =>
            tx.store(SourceStore).publishSourceDocument({
              id: source.id,
              expectedRevision: 1,
              requestId: correction.requestId!,
              document: {
                blocks: [correctBlockText(block, 'Corrected extraction')],
                meta: { ...meta, corrected: true }
              }
            })
          );
          const beforeProjection = yield* rpc('materials.resolveEvidence', {
            kind: 'range',
            target
          });

          assert.equal(beforeProjection.availability, 'available');
          if (beforeProjection.availability === 'available') {
            assert.equal(beforeProjection.excerpt, '😀');
            assert.equal(beforeProjection.precision, 'exact');
            assert.equal(beforeProjection.revision.state, 'stale');
            assert.equal(
              beforeProjection.revision.currentVersionId,
              projected.extracted.version.id
            );
            assert.equal(beforeProjection.revision.currentDocumentId, first.documentId);
            assert.deepEqual(beforeProjection.revision.source, {
              sourceId: source.id,
              inputRevision: 1,
              currentRevision: 1,
              inputDocumentId: first.documentId,
              currentDocumentId: corrected.documentId
            });
          }
          const pendingSupport = yield* rpc('materials.citationSupport', {
            versionId: derived.version.id,
            marker: 1n
          });

          assert.equal(pendingSupport.state, 'stale');
          const pendingStatus = yield* rpc('materials.dependencyStatus', {
            id: projected.extracted.version.id,
            limit: 10
          });
          const pendingDependency = pendingStatus.items.find(
            (item) => item.dependentVersionId === derived.version.id
          );

          assert.equal(pendingDependency?.inputVersionId, projected.extracted.version.id);
          assert.equal(pendingDependency?.currentVersionId, projected.extracted.version.id);
          assert.equal(pendingDependency?.currentDocumentId, first.documentId);
          assert.equal(pendingDependency?.source?.inputDocumentId, first.documentId);
          assert.equal(pendingDependency?.source?.currentDocumentId, corrected.documentId);
          assert.equal(pendingDependency?.state, 'stale');
          const current = yield* project(corrected.documentId, 'corrected-evidence');
          const old = yield* rpc('materials.resolveEvidence', { kind: 'range', target });

          assert.equal(old.availability, 'available');
          if (old.availability === 'available') {
            assert.equal(old.excerpt, '😀');
            assert.deepEqual(old.location, block.anchor);
            assert.equal(old.precision, 'exact');
            assert.equal(old.locationPrecision, 'approximate');
            assert.equal(old.revision.state, 'stale');
            assert.equal(old.revision.currentVersionId, current.extracted.version.id);
            assert.equal(old.revision.currentDocumentId, corrected.documentId);
            assert.equal(old.revision.source?.inputDocumentId, first.documentId);
            assert.equal(old.revision.source?.currentDocumentId, corrected.documentId);
          }
          const invalidated = yield* rpc('materials.citationSupport', {
            versionId: derived.version.id,
            marker: 1n
          });

          assert.equal(invalidated.state, 'stale');
          if (invalidated.state !== 'unassessed') {
            assert.ok(invalidated.reasons.includes('evidence_changed'));
            assert.deepEqual(invalidated.assessment.evidence, target);
          }
          const status = yield* rpc('materials.dependencyStatus', {
            id: projected.extracted.version.id,
            limit: 10
          });

          assert.ok(
            status.items.some(
              (item) =>
                item.dependentVersionId === derived.version.id &&
                item.inputDocumentId === first.documentId &&
                item.currentDocumentId === corrected.documentId &&
                item.state === 'stale'
            )
          );
          const legacy = yield* rpc('materials.resolveEvidence', {
            kind: 'anchor',
            versionId: projected.extracted.version.id,
            anchor: block.anchor,
            quote: block.text
          });

          assert.equal(legacy.availability, 'available');
          if (legacy.availability === 'available') {
            assert.equal(legacy.precision, 'approximate');
            assert.equal(legacy.block, null);
            assert.equal(legacy.excerpt, null);
          }
          yield* sources.replaceSource({
            id: source.id,
            expectedRevision: 1,
            name: 'replacement.txt',
            bytes: new TextEncoder().encode('replacement')
          });
          const replaced = yield* rpc('materials.resolveEvidence', { kind: 'range', target });

          if (replaced.availability !== 'available')
            throw new Error('Historic target must survive replacement');
          assert.equal(replaced.excerpt, '😀');
          assert.deepEqual(replaced.revision.source, {
            sourceId: source.id,
            inputRevision: 1,
            currentRevision: 2,
            inputDocumentId: first.documentId,
            currentDocumentId: corrected.documentId
          });
          assert.deepEqual(
            (yield* rpc('materials.materialVersion', { id: derived.version.id })).inputs,
            [projected.extracted.version.id]
          );
          if (annotation.outcome === 'saved')
            assert.deepEqual(
              (yield* rpc('materials.annotation', { id: annotation.annotation.id })).target,
              target
            );
          assert.deepEqual(
            (yield* materials.materialVersionExport({ id: projected.original.version.id })).bytes,
            new TextEncoder().encode('A😀B original')
          );
        }).pipe(Effect.provide(handlers(context)))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
