/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists exact authored annotation targets and append-only guarded revisions.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Persists exact authored annotation targets and append-only guarded revisions.          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside Pages ownership; callers own                │
 * │ transaction scope.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { PageAnnotationId } from '@study/contracts/ids';
import * as c from '@study/contracts/pages/evidence';
import { and, desc, eq, lt, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { validRange } from '#server/features/pages/decoders/range';
import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { makePageDomain } from './domain.ts';

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
  const pages = makePageDomain(resources);

  function annotation(id: PageAnnotationId) {
    const a = orm.select().from(s.page_annotations).where(eq(s.page_annotations.id, id)).get();

    if (!a) throw new StudyError('not_found', 'Page annotation not found');

    pages.page(a.page_id);
    const r = orm
      .select()
      .from(s.page_annotation_revisions)
      .where(
        and(
          eq(s.page_annotation_revisions.annotation_id, id),
          eq(s.page_annotation_revisions.revision, a.revision)
        )
      )
      .get();

    if (!r) throw new StudyError('not_found', 'Page annotation revision not found');

    pages.version(r.version_id);

    return Schema.decodeUnknownSync(codec)(r.payload);
  }

  function assertTarget(target: typeof c.annotationTargetSchema.Type) {
    const v = pages.version(target.range.versionId);
    const range = target.range;

    if (
      v.pageId !== target.pageId ||
      v.status !== 'published' ||
      v.snapshotId !== range.snapshotId ||
      !validRange(v.document, range)
    )
      throw new StudyError('invalid_input', 'Annotation requires an exact published UTF-16 range');
  }

  function append(a: typeof c.annotationSchema.Type) {
    orm
      .insert(s.page_annotation_revisions)
      .values({
        annotation_id: a.id,
        revision: a.revision,
        page_id: a.target.pageId,
        version_id: a.target.range.versionId,
        snapshot_id: a.target.range.snapshotId,
        payload: Schema.encodeSync(codec)(a)
      })
      .run();

    if (a.revision > 1n)
      orm
        .update(s.page_annotations)
        .set({ revision: a.revision })
        .where(eq(s.page_annotations.id, a.id))
        .run();

    return { outcome: 'saved' as const, annotation: a };
  }

  function create(v: typeof c.createAnnotationSchema.Type) {
    assertTarget(v.target);
    const row = orm
      .insert(s.page_annotations)
      .values({ page_id: v.target.pageId, revision: 1n })
      .returning()
      .get();

    return append({ ...v, id: row.id, revision: 1n, deleted: false, operation: 'create' });
  }

  function revise(v: typeof c.reviseAnnotationSchema.Type) {
    const a = annotation(v.id);

    if (a.revision !== v.expectedRevision) return { outcome: 'conflict' as const, annotation: a };

    if (a.deleted || v.target.pageId !== a.target.pageId)
      throw new StudyError(
        'invalid_input',
        'Annotation identity cannot move between pages or revive a tombstone'
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
      .from(s.page_annotation_revisions)
      .where(
        and(
          eq(s.page_annotation_revisions.annotation_id, v.id),
          v.cursor === undefined ? undefined : lt(s.page_annotation_revisions.revision, v.cursor)
        )
      )
      .orderBy(desc(s.page_annotation_revisions.revision))
      .limit(v.limit + 1)
      .all();

    return annotationPage(rows, v.limit, (row) => row.revision);
  }

  function annotations(v: typeof c.annotationsSchema.Type) {
    pages.aggregate(v.pageId);
    const rows = orm
      .select({
        id: s.page_annotations.id,
        payload: s.page_annotation_revisions.payload
      })
      .from(s.page_annotations)
      .innerJoin(
        s.page_annotation_revisions,
        and(
          eq(s.page_annotation_revisions.annotation_id, s.page_annotations.id),
          eq(s.page_annotation_revisions.revision, s.page_annotations.revision)
        )
      )
      .where(
        and(
          eq(s.page_annotations.page_id, v.pageId),
          v.cursor === undefined ? undefined : lt(s.page_annotations.id, v.cursor),
          v.versionId === undefined
            ? undefined
            : eq(s.page_annotation_revisions.version_id, v.versionId),
          v.includeDeleted
            ? undefined
            : sql`json_extract(${s.page_annotation_revisions.payload},'$.deleted')=0`,
          sql`NOT EXISTS(SELECT 1 FROM page_retirements r WHERE r.version_id=${s.page_annotation_revisions.version_id})`
        )
      )
      .orderBy(desc(s.page_annotations.id))
      .limit(v.limit + 1)
      .all();

    return annotationPage(rows, v.limit, (row) => row.id);
  }

  return { annotation, create, revise, revisions, annotations };
}

export const PageAnnotationsStore = defineStore({
  name: 'study/PageAnnotationsStore',
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

export const PageAnnotationHistoryStore = defineStore({
  name: 'study/PageAnnotationHistoryStore',
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
