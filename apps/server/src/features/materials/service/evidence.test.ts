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

import { ConversationsRpc } from '@study/contracts/conversations/rpc';
import type { chatMessageSchema } from '@study/contracts/conversations/schemas';
import { documentIdSchema, materialVersionIdSchema } from '@study/contracts/ids';
import type { DocumentId, MaterialVersionId } from '@study/contracts/ids';
import type {
  dependencyPageSchema,
  evidenceResolutionSchema,
  evidenceRevisionSchema
} from '@study/contracts/materials/evidence';
import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { createBlock, correctBlockText } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Conversations } from '#server/features/conversations/index';
import { ConversationsRpcLive } from '#server/features/conversations/rpc/index';
import { Materials } from '#server/features/materials/index';
import { MaterialsRpcLive } from '#server/features/materials/rpc/index';
import { MaterialsStore } from '#server/features/materials/store/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { SourceStore } from '#server/features/sources/store/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';
import { withTestPublication } from '#testing/publication';

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

function assertProjectedHistoricEvidence(
  evidence: typeof evidenceResolutionSchema.Type,
  anchor: (typeof chatMessageSchema.Type.citations)[number]['anchor'],
  versionId: MaterialVersionId,
  source: NonNullable<typeof evidenceRevisionSchema.Type.source>
) {
  assert.equal(evidence.availability, 'available');

  if (evidence.availability === 'available') {
    assert.equal(evidence.excerpt, '😀');
    assert.deepEqual(evidence.location, anchor);
    assert.equal(evidence.precision, 'exact');
    assert.equal(evidence.locationPrecision, 'approximate');
    assert.equal(evidence.revision.state, 'stale');
    assert.equal(evidence.revision.currentVersionId, versionId);
    assert.equal(evidence.revision.currentDocumentId, source.currentDocumentId);
    assert.equal(evidence.revision.source?.inputDocumentId, source.inputDocumentId);
    assert.equal(evidence.revision.source?.currentDocumentId, source.currentDocumentId);
  }
}

function assertPendingCorrectionDependency(
  dependency: (typeof dependencyPageSchema.Type.items)[number] | undefined,
  versionId: MaterialVersionId,
  inputDocumentId: DocumentId,
  currentDocumentId: DocumentId
) {
  assert.equal(dependency?.inputVersionId, versionId);
  assert.equal(dependency?.currentVersionId, versionId);
  assert.equal(dependency?.currentDocumentId, inputDocumentId);
  assert.equal(dependency?.source?.inputDocumentId, inputDocumentId);
  assert.equal(dependency?.source?.currentDocumentId, currentDocumentId);
  assert.equal(dependency?.state, 'stale');
}

function assertHistoricCitation(
  message: typeof chatMessageSchema.Type,
  original: typeof chatMessageSchema.Type,
  source: {
    sourceId: NonNullable<(typeof original.citations)[number]['sourceId']>;
    inputRevision: number;
    currentRevision: number;
    inputDocumentId: NonNullable<(typeof original.citations)[number]['documentId']>;
    currentDocumentId: NonNullable<(typeof original.citations)[number]['documentId']>;
  }
) {
  const citation = message.citations[0]!;
  const { evidence: _evidence, ...stored } = citation;
  const { evidence: _originalEvidence, ...originalStored } = original.citations[0]!;

  assert.deepEqual(stored, originalStored);
  assert.equal(citation.precision, 'exact');
  assert.deepEqual(citation.support, { state: 'unassessed' });
  assert.equal(citation.evidence?.availability, 'available');

  if (citation.evidence?.availability !== 'available')
    throw new Error('Expected historic evidence');

  assert.equal(citation.evidence.origin, 'import');
  assert.equal(citation.evidence.excerpt, '😀');
  assert.equal(citation.evidence.precision, 'exact');
  assert.equal(citation.evidence.locationPrecision, 'approximate');
  assert.deepEqual(citation.evidence.location, {
    type: 'text',
    lineStart: 0,
    lineEnd: 0,
    start: 0,
    end: 15
  });
  assert.equal(citation.evidence.revision.state, 'stale');
  assert.deepEqual(citation.evidence.revision.source, source);
}

test('standalone annotation CRUD preserves exact rich Unicode history, conflicts, outbox atomicity and reopen', async () => {
  const location = createTestDatabase();
  let context = new ServerContext(location.open());

  function handlers() {
    return MaterialsRpcLive.pipe(
      Layer.provideMerge(Layer.mergeAll(Materials.layer, Sources.layer)),
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );
  }

  function annotationState() {
    return {
      heads: context.db.orm.select().from(s.material_annotations).all(),
      revisions: context.db.orm.select().from(s.material_annotation_revisions).all(),
      events: context.db.orm.select().from(s.workflowEvents).all()
    };
  }

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
          const beforeConflicts = annotationState();
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
            assert.deepEqual(conflict.submitted, {
              id: created.annotation.id,
              expectedRevision: 1n,
              target: { ...target, range: { ...target.range, start: 3, end: 4 } }
            });
          }

          assert.equal(
            (yield* rpc('materials.deleteAnnotation', {
              id: created.annotation.id,
              expectedRevision: 1n
            })).outcome,
            'conflict'
          );
          assert.deepEqual(annotationState(), beforeConflicts);
          const other = yield* rpc('materials.createManualDocument', {
            title: 'Other identity',
            document: { blocks: [paragraph('A😀B rich')], meta }
          });
          const beforeWrongOwner = annotationState();

          assert.equal(
            (yield* Effect.flip(
              rpc('materials.reanchorAnnotation', {
                id: created.annotation.id,
                expectedRevision: 2n,
                target: { ...target, materialId: other.id }
              })
            )).kind,
            'invalid_input'
          );
          assert.deepEqual(annotationState(), beforeWrongOwner);
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
          const before = annotationState();

          context.db.orm.run(
            sql.raw(
              "CREATE TRIGGER reject_annotation_event BEFORE INSERT ON workflow_events WHEN NEW.type = 'MaterialAnnotationChanged' BEGIN SELECT RAISE(ABORT, 'injected outbox failure'); END"
            )
          );

          for (const mutation of [
            materials.createAnnotation({ target, kind: 'note', note: 'Rolled back identity' }),
            materials.updateAnnotation({
              id: created.annotation.id,
              expectedRevision: 3n,
              kind: 'note',
              note: 'Rolled back note'
            }),
            materials.reanchorAnnotation({
              id: created.annotation.id,
              expectedRevision: 3n,
              target
            }),
            materials.deleteAnnotation({ id: created.annotation.id, expectedRevision: 3n })
          ]) {
            yield* Effect.flip(mutation);
            assert.deepEqual(annotationState(), before);
          }

          assert.equal(
            (yield* rpc('materials.annotation', { id: created.annotation.id })).revision,
            3n
          );
          context.db.orm.run(sql.raw('DROP TRIGGER reject_annotation_event'));

          const revisionRow = before.revisions[0]!;
          const otherDocumentId = context.db.orm
            .select()
            .from(s.material_document_versions)
            .where(eq(s.material_document_versions.version_id, other.version.id))
            .get()!.document_id;
          const foreignRevision = {
            ...JSON.parse(revisionRow.payload),
            revision: '4',
            target: {
              materialId: String(other.id),
              range: {
                ...JSON.parse(revisionRow.payload).target.range,
                versionId: String(other.version.id),
                documentId: String(otherDocumentId)
              }
            }
          };

          assert.throws(() =>
            context.db.orm
              .insert(s.material_annotation_revisions)
              .values({
                annotation_id: created.annotation.id,
                revision: 4n,
                version_id: other.version.id,
                document_id: otherDocumentId,
                payload: JSON.stringify(foreignRevision)
              })
              .run()
          );
          assert.throws(() => context.db.orm.delete(s.material_annotations).run());
          assert.throws(() =>
            context.db.orm.update(s.material_annotations).set({ revision: 9n }).run()
          );
          assert.throws(() =>
            context.db.orm.update(s.material_annotations).set({ material_id: other.id }).run()
          );
          assert.throws(() => context.db.orm.delete(s.material_annotation_revisions).run());
          assert.throws(() =>
            context.db.orm.update(s.material_annotation_revisions).set({ payload: '{}' }).run()
          );
          assert.deepEqual(annotationState(), before);
          const retry = yield* rpc('materials.updateAnnotation', {
            id: created.annotation.id,
            expectedRevision: 3n,
            kind: 'note',
            note: 'Retried after rollback'
          });

          assert.equal(retry.outcome, 'saved');
          assert.equal(annotationState().events.length, before.events.length + 1);
          const historyPage = yield* rpc('materials.annotationHistory', {
            id: created.annotation.id,
            limit: 2
          });

          assert.deepEqual(
            historyPage.items.map((item) => item.revision),
            [1n, 2n]
          );
          assert.equal(historyPage.nextCursor, 2n);
          const historyTail = yield* rpc('materials.annotationHistory', {
            id: created.annotation.id,
            limit: 2,
            cursor: historyPage.nextCursor!
          });

          assert.deepEqual(
            historyTail.items.map((item) => item.revision),
            [3n, 4n]
          );
          assert.equal(historyTail.nextCursor, null);
          const page = yield* rpc('materials.annotations', { materialId: material.id, limit: 1 });

          assert.equal(page.items.length, 1);

          return { id: created.annotation.id, materialId: material.id, target };
        }).pipe(Effect.provide(handlers()))
      )
    );

    context.close();
    context = new ServerContext(location.open());
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
          const reopened = yield* rpc('materials.annotation', { id: retained.id });

          assert.equal(reopened.revision, 4n);
          assert.equal(reopened.note, 'Retried after rollback');
          assert.equal(
            (yield* rpc('materials.deleteAnnotation', { id: retained.id, expectedRevision: 4n }))
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
            5
          );
          assert.equal(
            (yield* rpc('materials.material', { id: retained.materialId })).id,
            retained.materialId
          );
          const tombstoneState = annotationState();
          const deleted = yield* rpc('materials.annotation', { id: retained.id });

          assert.equal(deleted.deleted, true);
          assert.equal(deleted.revision, 5n);
          assert.equal(
            (yield* rpc('materials.updateAnnotation', {
              id: retained.id,
              expectedRevision: 5n,
              kind: 'note',
              note: 'No resurrection'
            })).outcome,
            'unavailable'
          );
          assert.equal(
            (yield* rpc('materials.reanchorAnnotation', {
              id: retained.id,
              expectedRevision: 5n,
              target: retained.target
            })).outcome,
            'unavailable'
          );
          assert.equal(
            (yield* rpc('materials.deleteAnnotation', { id: retained.id, expectedRevision: 5n }))
              .outcome,
            'unavailable'
          );
          assert.deepEqual(annotationState(), tombstoneState);
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

          if (missing.availability === 'unavailable')
            assert.equal(missing.reason, 'version_missing');

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

          if (mismatch.availability === 'unavailable')
            assert.equal(mismatch.reason, 'document_mismatch');

          for (const [range, reason] of [
            [{ ...retained.target.range, blockId: paragraph('A😀B rich').id }, 'block_missing'],
            [{ ...retained.target.range, start: 2, end: 3 }, 'range_invalid'],
            [{ ...retained.target.range, start: 1, end: 1 }, 'range_invalid']
          ] as const) {
            const reference = { kind: 'range' as const, target: { ...retained.target, range } };
            const unresolved = yield* rpc('materials.resolveEvidence', reference);

            assert.deepEqual(unresolved, {
              availability: 'unavailable',
              precision: 'unavailable',
              reference,
              reason
            });
          }

          const old = yield* rpc('materials.resolveEvidence', {
            kind: 'range',
            target: retained.target
          });

          assert.equal(old.availability, 'available');

          if (old.availability === 'available') assert.equal(old.excerpt, '😀');
        }).pipe(Effect.provide(handlers()))
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

  function handlers() {
    return MaterialsRpcLive.pipe(
      Layer.provideMerge(Layer.mergeAll(Materials.layer, Sources.layer)),
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );
  }

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
          const assessmentInput = {
            claim: target,
            evidence,
            marker: 1n,
            judgment: 'supports' as const,
            note: 'My judgment'
          };
          const assessmentsBefore = context.db.orm
            .select()
            .from(s.material_citation_assessments)
            .all();

          for (const invalidAssessment of [
            { ...assessmentInput, evidence: { ...evidence, range: { ...evidence.range, end: 5 } } },
            { ...assessmentInput, claim: { ...target, materialId: input.id } },
            { ...assessmentInput, marker: 2n }
          ]) {
            assert.equal(
              (yield* Effect.flip(rpc('materials.assessCitation', invalidAssessment))).kind,
              'invalid_input'
            );
            assert.deepEqual(
              context.db.orm.select().from(s.material_citation_assessments).all(),
              assessmentsBefore
            );
          }

          context.db.orm.run(
            sql`CREATE TRIGGER reject_assessment_insert AFTER INSERT ON material_citation_assessments BEGIN SELECT RAISE(ABORT, 'injected assessment failure'); END`
          );
          yield* Effect.flip(rpc('materials.assessCitation', assessmentInput));
          assert.deepEqual(
            context.db.orm.select().from(s.material_citation_assessments).all(),
            assessmentsBefore
          );
          assert.equal(
            (yield* rpc('materials.citationSupport', { versionId: claim.version.id, marker: 1n }))
              .state,
            'unassessed'
          );
          context.db.orm.run(sql`DROP TRIGGER reject_assessment_insert`);
          const assessed = yield* rpc('materials.assessCitation', {
            claim: target,
            evidence,
            marker: 1n,
            judgment: 'supports',
            note: 'My judgment'
          });

          assert.equal(assessed.state, 'assessed');

          assert.equal(assessed.assessment.independentVerification, false);
          assert.equal(assessed.assessment.suppliedBy, 'user');

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

          assert.ok(stale.reasons.includes('claim_changed'));
          assert.equal(stale.claim.availability, 'available');
          assert.deepEqual(stale.assessment.claim, target);

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
          const assessmentRows = context.db.orm
            .select()
            .from(s.material_citation_assessments)
            .all();

          assert.throws(() => context.db.orm.delete(s.material_citation_assessments).run());
          assert.throws(() =>
            context.db.orm.update(s.material_citation_assessments).set({ payload: '{}' }).run()
          );
          const retainedAssessment = assessmentRows[0]!;

          assert.throws(() =>
            context.db.orm
              .insert(s.material_citation_assessments)
              .values({
                claim_version_id: retainedAssessment.claim_version_id,
                evidence_version_id: retainedAssessment.evidence_version_id,
                marker: retainedAssessment.marker,
                payload: JSON.stringify({
                  ...JSON.parse(retainedAssessment.payload),
                  independentVerification: true
                })
              })
              .run()
          );
          assert.deepEqual(
            context.db.orm.select().from(s.material_citation_assessments).all(),
            assessmentRows
          );
          assert.equal(
            context.db.orm.select().from(s.material_citation_assessments).all().length,
            1
          );
          assert.deepEqual(
            (yield* rpc('materials.materialVersion', { id: claim.version.id })).inputs,
            [input.version.id]
          );
        }).pipe(Effect.provide(handlers()))
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
          const chats = yield* Conversations;
          const chatRpc = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });
          const session = yield* chatRpc('conversations.createSession', {
            title: 'Historic source'
          });

          yield* chatRpc('conversations.updateSessionSelection', {
            sessionId: session.id,
            expectedRevision: 0n,
            targets: [
              {
                versionId: projected.extracted.version.id,
                documentId: first.documentId,
                scope: {
                  kind: 'ranges',
                  ranges: [
                    {
                      versionId: projected.extracted.version.id,
                      documentId: first.documentId,
                      blockId: block.id,
                      start: 1,
                      end: 3
                    }
                  ]
                }
              }
            ]
          });
          const request = yield* chatRpc('conversations.requestReply', {
            sessionId: session.id,
            intentKey: 'historic-source-reply',
            instruction: 'Explain the selected passage'
          });

          yield* withTestPublication(
            context,
            chats
              .publishReply({
                requestId: request.requestId,
                text: 'Historic citation [1]',
                citations: [
                  {
                    marker: 1,
                    sourceId: null,
                    materialVersionId: projected.extracted.version.id,
                    documentId: first.documentId,
                    blockOrdinal: 0,
                    quote: '😀'
                  }
                ]
              })
              .pipe(Effect.asVoid)
          );
          const originalReply = yield* chatRpc('conversations.message', { id: request.messageId });

          assert.equal(originalReply.citations[0]?.evidence?.availability, 'available');

          if (originalReply.citations[0]?.evidence?.availability === 'available')
            assert.equal(originalReply.citations[0].evidence.revision.state, 'current');

          const storedCitations = context.db.orm.select().from(s.citations).all();
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

          const sourceRevision = {
            sourceId: source.id,
            inputRevision: 1,
            currentRevision: 1,
            inputDocumentId: first.documentId,
            currentDocumentId: corrected.documentId
          };
          const correctedReply = yield* chatRpc('conversations.message', { id: request.messageId });

          assertHistoricCitation(correctedReply, originalReply, sourceRevision);
          const correctedThread = yield* chatRpc('conversations.thread', {
            sessionId: session.id,
            limit: 10
          });

          assert.deepEqual(
            correctedThread.items.find((item) => item.id === request.messageId)?.citations,
            correctedReply.citations
          );
          const editedReply = yield* chatRpc('conversations.editMessage', {
            messageId: request.messageId,
            text: 'Qualified historic citation [1]'
          });

          assertHistoricCitation(editedReply, originalReply, sourceRevision);
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

          assertPendingCorrectionDependency(
            pendingDependency,
            projected.extracted.version.id,
            first.documentId,
            corrected.documentId
          );

          const current = yield* project(corrected.documentId, 'corrected-evidence');
          const projectedReply = yield* chatRpc('conversations.setActiveVersion', {
            messageId: request.messageId,
            versionId: originalReply.activeVersionId!
          });

          assertHistoricCitation(projectedReply, originalReply, sourceRevision);
          const old = yield* rpc('materials.resolveEvidence', { kind: 'range', target });

          assertProjectedHistoricEvidence(
            old,
            block.anchor,
            current.extracted.version.id,
            sourceRevision
          );

          const invalidated = yield* rpc('materials.citationSupport', {
            versionId: derived.version.id,
            marker: 1n
          });

          assert.equal(invalidated.state, 'stale');

          assert.ok(invalidated.reasons.includes('evidence_changed'));
          assert.deepEqual(invalidated.assessment.evidence, target);

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
          const replacedSource = { ...sourceRevision, currentRevision: 2 };
          const replacedReply = yield* chatRpc('conversations.message', { id: request.messageId });

          assertHistoricCitation(replacedReply, originalReply, replacedSource);
          const replacedThread = yield* chatRpc('conversations.thread', {
            sessionId: session.id,
            limit: 10
          });

          assert.deepEqual(
            replacedThread.items.find((item) => item.id === request.messageId)?.citations,
            replacedReply.citations
          );
          assertHistoricCitation(
            yield* chatRpc('conversations.editMessage', {
              messageId: request.messageId,
              text: 'Replacement still cites history [1]'
            }),
            originalReply,
            replacedSource
          );
          assertHistoricCitation(
            yield* chatRpc('conversations.setActiveVersion', {
              messageId: request.messageId,
              versionId: editedReply.activeVersionId!
            }),
            originalReply,
            replacedSource
          );
          assert.deepEqual(
            context.db.orm
              .select()
              .from(s.citations)
              .where(eq(s.citations.version_id, originalReply.activeVersionId!))
              .all(),
            storedCitations
          );
          const replacedSupport = yield* rpc('materials.citationSupport', {
            versionId: derived.version.id,
            marker: 1n
          });

          assert.equal(replacedSupport.state, 'stale');

          assert.deepEqual(replacedSupport.assessment, judgment.assessment);
          assert.deepEqual(replacedSupport.reasons, ['evidence_changed']);

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
        }).pipe(
          Effect.provide(
            Layer.mergeAll(MaterialsRpcLive, ConversationsRpcLive).pipe(
              Layer.provideMerge(
                Layer.mergeAll(Materials.layer, Sources.layer, Conversations.layer, Settings.layer)
              ),
              Layer.provideMerge(Layer.succeed(Database, { store: context }))
            )
          )
        )
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});
