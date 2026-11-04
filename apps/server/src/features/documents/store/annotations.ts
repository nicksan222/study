/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists exact authored annotation targets and append-only guarded revisions.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Persists exact authored annotation targets and append-only guarded revisions.          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside Documents ownership; callers own            │
 * │ transaction scope.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import * as c from '@study/contracts/documents/evidence';
import { StudyError } from '@study/contracts/errors';
import type { StudyDocumentAnnotationId } from '@study/contracts/ids';
import { and, desc, eq, lt, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { validRange } from '#server/features/documents/decoders/range';
import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeDocumentDomain } from './domain.ts';

const codec = Schema.fromJsonString(Schema.toCodecJson(c.annotationSchema));

function annotationPage<Row extends { payload: string }, Cursor>(
  rows: Row[],
  limit: number,
  cursor: (row: Row) => Cursor
) {
  return {
    items: rows.slice(0, limit).map((row) => Schema.decodeUnknownSync(codec)(row.payload)),
    nextCursor: rows.length > limit ? cursor(rows[limit - 1]!) : null
  };
}

function makeAnnotations(resources: StoreResources) {
  const orm = resources.db.orm;
  const documents = makeDocumentDomain(resources);

  function annotation(id: StudyDocumentAnnotationId) {
    const a = orm
      .select()
      .from(s.study_document_annotations)
      .where(eq(s.study_document_annotations.id, id))
      .get();

    if (!a) throw new StudyError('not_found', 'Document annotation not found');

    documents.document(a.document_id);
    const r = orm
      .select()
      .from(s.study_document_annotation_revisions)
      .where(
        and(
          eq(s.study_document_annotation_revisions.annotation_id, id),
          eq(s.study_document_annotation_revisions.revision, a.revision)
        )
      )
      .get();

    if (!r) throw new StudyError('not_found', 'Document annotation revision not found');

    documents.version(r.version_id);

    return Schema.decodeUnknownSync(codec)(r.payload);
  }

  function assertTarget(target: typeof c.annotationTargetSchema.Type) {
    const v = documents.version(target.range.versionId);
    const range = target.range;

    if (
      v.documentId !== target.documentId ||
      v.status !== 'published' ||
      v.snapshotId !== range.snapshotId ||
      !validRange(v.document, range)
    )
      throw new StudyError('invalid_input', 'Annotation requires an exact published UTF-16 range');
  }

  function append(a: typeof c.annotationSchema.Type) {
    orm
      .insert(s.study_document_annotation_revisions)
      .values({
        annotation_id: a.id,
        revision: a.revision,
        document_id: a.target.documentId,
        version_id: a.target.range.versionId,
        snapshot_id: a.target.range.snapshotId,
        payload: Schema.encodeSync(codec)(a)
      })
      .run();

    if (a.revision > 1n)
      orm
        .update(s.study_document_annotations)
        .set({ revision: a.revision })
        .where(eq(s.study_document_annotations.id, a.id))
        .run();

    return { outcome: 'saved' as const, annotation: a };
  }

  function create(v: typeof c.createAnnotationSchema.Type) {
    assertTarget(v.target);
    const row = orm
      .insert(s.study_document_annotations)
      .values({ document_id: v.target.documentId, revision: 1n })
      .returning()
      .get();

    return append({ ...v, id: row.id, revision: 1n, deleted: false, operation: 'create' });
  }

  function revise(v: typeof c.reviseAnnotationSchema.Type) {
    const a = annotation(v.id);

    if (a.revision !== v.expectedRevision) return { outcome: 'conflict' as const, annotation: a };

    if (a.deleted || v.target.documentId !== a.target.documentId)
      throw new StudyError(
        'invalid_input',
        'Annotation identity cannot move between documents or revive a tombstone'
      );

    assertTarget(v.target);
    const reanchored = !Schema.toEquivalence(c.annotationTargetSchema)(a.target, v.target);

    return append({
      id: a.id,
      revision: a.revision + 1n,
      target: v.target,
      kind: v.kind,
      note: v.note,
      deleted: v.deleted,
      operation: v.deleted ? 'delete' : reanchored ? 'reanchor' : 'update'
    });
  }

  function revisions(v: typeof c.annotationHistorySchema.Type) {
    annotation(v.id);
    const rows = orm
      .select()
      .from(s.study_document_annotation_revisions)
      .where(
        and(
          eq(s.study_document_annotation_revisions.annotation_id, v.id),
          v.cursor === undefined
            ? undefined
            : lt(s.study_document_annotation_revisions.revision, v.cursor)
        )
      )
      .orderBy(desc(s.study_document_annotation_revisions.revision))
      .limit(v.limit + 1)
      .all();

    return annotationPage(rows, v.limit, (row) => row.revision);
  }

  function annotations(v: typeof c.annotationsSchema.Type) {
    documents.aggregate(v.documentId);
    const rows = orm
      .select({
        id: s.study_document_annotations.id,
        payload: s.study_document_annotation_revisions.payload
      })
      .from(s.study_document_annotations)
      .innerJoin(
        s.study_document_annotation_revisions,
        and(
          eq(s.study_document_annotation_revisions.annotation_id, s.study_document_annotations.id),
          eq(s.study_document_annotation_revisions.revision, s.study_document_annotations.revision)
        )
      )
      .where(
        and(
          eq(s.study_document_annotations.document_id, v.documentId),
          v.cursor === undefined ? undefined : lt(s.study_document_annotations.id, v.cursor),
          v.versionId === undefined
            ? undefined
            : eq(s.study_document_annotation_revisions.version_id, v.versionId),
          v.includeDeleted
            ? undefined
            : sql`json_extract(${s.study_document_annotation_revisions.payload},'$.deleted')=0`,
          sql`NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=${s.study_document_annotation_revisions.version_id})`
        )
      )
      .orderBy(desc(s.study_document_annotations.id))
      .limit(v.limit + 1)
      .all();

    return annotationPage(rows, v.limit, (row) => row.id);
  }

  return { annotation, create, revise, revisions, annotations };
}

export const DocumentAnnotationsStore = defineStore({
  name: 'study/DocumentAnnotationsStore',
  entity: { singular: 'annotation', plural: 'annotations' },
  make: (resources) => {
    const a = makeAnnotations(resources);

    return {
      queries: {
        annotations: storeQuery({
          role: 'collection',
          input: c.annotationsSchema,
          output: c.annotationsPageSchema,
          run: a.annotations
        }),
        annotation: storeQuery({
          role: 'required',
          input: c.annotationKeySchema,
          output: c.annotationSchema,
          run: (v) => a.annotation(v.id)
        })
      },
      mutations: {
        createAnnotation: storeMutation({
          input: c.createAnnotationSchema,
          output: c.annotationOutcomeSchema,
          run: a.create
        }),
        reviseAnnotation: storeMutation({
          input: c.reviseAnnotationSchema,
          output: c.annotationOutcomeSchema,
          run: a.revise
        })
      }
    };
  }
});

export const DocumentAnnotationHistoryStore = defineStore({
  name: 'study/DocumentAnnotationHistoryStore',
  entity: { singular: 'annotationRevision', plural: 'annotationHistory' },
  make: (resources) => ({
    queries: {
      annotationHistory: storeQuery({
        role: 'collection',
        input: c.annotationHistorySchema,
        output: c.annotationPageSchema,
        run: makeAnnotations(resources).revisions
      })
    },
    mutations: {}
  })
});
