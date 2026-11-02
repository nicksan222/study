/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Retains exact annotation history with conflict checked explicit reanchoring.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Persists revisions and tombstones without modifying retained library content.          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Materials owns all annotation persistence inside synchronous database transactions.      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { MaterialAnnotationId } from '@study/contracts/ids';
import * as contract from '@study/contracts/materials/evidence';
import { and, asc, eq, gt, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeEvidence } from './evidence.ts';
import { required } from './reads.ts';

const codec = Schema.fromJsonString(Schema.toCodecJson(contract.annotationRevisionSchema));

function makeAnnotations(resources: StoreResources) {
  const { db } = resources;
  const evidence = makeEvidence(resources);
  const decode = Schema.decodeUnknownSync(codec);
  const encode = Schema.encodeSync(codec);

  function currentRevision() {
    return and(
      eq(s.material_annotation_revisions.annotation_id, s.material_annotations.id),
      eq(s.material_annotation_revisions.revision, s.material_annotations.revision)
    );
  }

  function read(id: MaterialAnnotationId) {
    const row = db.orm
      .select({ payload: s.material_annotation_revisions.payload })
      .from(s.material_annotations)
      .innerJoin(s.material_annotation_revisions, currentRevision())
      .where(eq(s.material_annotations.id, id))
      .get();

    if (!row) return null;

    const value = decode(row.payload);
    if (
      db.orm
        .select()
        .from(s.material_history_members)
        .where(eq(s.material_history_members.version_id, value.target.range.versionId))
        .get()
    )
      return null;

    if (
      db.orm
        .select()
        .from(s.material_deletion_members)
        .where(eq(s.material_deletion_members.material_id, value.target.materialId))
        .get()
    )
      return null;

    return { ...value, evidence: evidence.resolve({ kind: 'range', target: value.target }) };
  }

  function append(value: typeof contract.annotationRevisionSchema.Type) {
    db.orm
      .insert(s.material_annotation_revisions)
      .values({
        annotation_id: value.id,
        revision: value.revision,
        version_id: value.target.range.versionId,
        document_id: value.target.range.documentId,
        payload: encode(value)
      })
      .run();

    if (value.revision > 1n)
      db.orm
        .update(s.material_annotations)
        .set({ revision: value.revision })
        .where(eq(s.material_annotations.id, value.id))
        .run();

    return { outcome: 'saved' as const, annotation: required(read(value.id)) };
  }

  function create(
    value: typeof contract.createAnnotationSchema.Type
  ): typeof contract.annotationOutcomeSchema.Type {
    const resolved = evidence.resolve({ kind: 'range', target: value.target });

    if (resolved.availability === 'unavailable')
      return { outcome: 'unavailable', current: null, evidence: resolved };

    const row = db.orm
      .insert(s.material_annotations)
      .values({ material_id: value.target.materialId, revision: 1n })
      .returning()
      .get();

    return append({
      ...value,
      id: required(row).id,
      revision: 1n,
      deleted: false,
      operation: 'create'
    });
  }

  function mutate(
    value:
      | typeof contract.updateAnnotationSchema.Type
      | typeof contract.reanchorAnnotationSchema.Type
      | typeof contract.annotationMutationSchema.Type,
    operation: 'update' | 'reanchor' | 'delete'
  ): typeof contract.annotationOutcomeSchema.Type {
    const current = read(value.id);

    if (!current) return { outcome: 'unavailable', current: null, evidence: null };

    if (current.revision !== value.expectedRevision)
      return { outcome: 'conflict', current, submitted: value };

    if (current.deleted) return { outcome: 'unavailable', current, evidence: current.evidence };

    const target = 'target' in value ? value.target : current.target;

    if (target.materialId !== current.target.materialId)
      throw new StudyError('invalid_input', 'Reanchor must retain Material identity');

    if (operation === 'reanchor') {
      const resolved = evidence.resolve({ kind: 'range', target });

      if (resolved.availability === 'unavailable')
        return { outcome: 'unavailable', current, evidence: resolved };
    }

    return append({
      id: current.id,
      revision: current.revision + 1n,
      target,
      kind: 'kind' in value ? value.kind : current.kind,
      note: 'note' in value ? value.note : current.note,
      deleted: operation === 'delete',
      operation
    });
  }

  function list(value: typeof contract.annotationPageInputSchema.Type) {
    if (
      db.orm
        .select()
        .from(s.material_deletion_members)
        .where(eq(s.material_deletion_members.material_id, value.materialId))
        .get()
    )
      throw new StudyError('not_found', 'Material is unavailable');

    const rows = db.orm
      .select({ id: s.material_annotations.id })
      .from(s.material_annotations)
      .innerJoin(s.material_annotation_revisions, currentRevision())
      .where(
        and(
          sql`json_extract(${s.material_annotation_revisions.payload}, '$.deleted') = 0`,
          eq(s.material_annotations.material_id, value.materialId),
          value.cursor === undefined ? undefined : gt(s.material_annotations.id, value.cursor)
        )
      )
      .orderBy(asc(s.material_annotations.id))
      .limit(value.limit + 1)
      .all();
    const page = rows.slice(0, value.limit);

    return {
      items: page.map((row) => required(read(row.id))),
      nextCursor: rows.length > value.limit ? page.at(-1)!.id : null
    };
  }

  function history(value: typeof contract.annotationHistoryInputSchema.Type) {
    if (!read(value.id)) throw new StudyError('not_found', 'Annotation is unavailable');

    const rows = db.orm
      .select()
      .from(s.material_annotation_revisions)
      .where(
        and(
          eq(s.material_annotation_revisions.annotation_id, value.id),
          value.cursor === undefined
            ? undefined
            : gt(s.material_annotation_revisions.revision, value.cursor)
        )
      )
      .orderBy(asc(s.material_annotation_revisions.revision))
      .limit(value.limit + 1)
      .all();
    const page = rows.slice(0, value.limit);

    return {
      items: page.map((row) => decode(row.payload)),
      nextCursor: rows.length > value.limit ? page.at(-1)!.revision : null
    };
  }

  return { read, create, mutate, list, history };
}

export const AnnotationsStore = defineStore({
  name: 'study/AnnotationsStore',
  entity: { singular: 'annotation', plural: 'annotations' },
  make: (resources) => {
    const actions = makeAnnotations(resources);

    return {
      queries: {
        annotation: storeQuery({
          role: 'required',
          input: contract.annotationKeySchema,
          output: contract.annotationSchema,
          run: (value) => actions.read(value.id)
        }),
        annotations: storeQuery({
          role: 'collection',
          input: contract.annotationPageInputSchema,
          output: contract.annotationPageSchema,
          run: actions.list
        })
      },
      mutations: {
        createAnnotation: storeMutation({
          input: contract.createAnnotationSchema,
          output: contract.annotationOutcomeSchema,
          run: actions.create
        }),
        updateAnnotation: storeMutation({
          input: contract.updateAnnotationSchema,
          output: contract.annotationOutcomeSchema,
          run: (value) => actions.mutate(value, 'update')
        }),
        reanchorAnnotation: storeMutation({
          input: contract.reanchorAnnotationSchema,
          output: contract.annotationOutcomeSchema,
          run: (value) => actions.mutate(value, 'reanchor')
        }),
        deleteAnnotation: storeMutation({
          input: contract.annotationMutationSchema,
          output: contract.annotationOutcomeSchema,
          run: (value) => actions.mutate(value, 'delete')
        })
      }
    };
  }
});

export const AnnotationHistoryStore = defineStore({
  name: 'study/AnnotationHistoryStore',
  entity: { singular: 'annotationRevision', plural: 'annotationRevisions' },
  make: (resources) => {
    const actions = makeAnnotations(resources);

    return {
      queries: {
        annotationRevisions: storeQuery({
          role: 'collection',
          input: contract.annotationHistoryInputSchema,
          output: contract.annotationHistorySchema,
          run: actions.history
        })
      },
      mutations: {}
    };
  }
});
