/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Material deletion owns exact scope, barriers and content retirement; native        │
 * │ Workflow owns execution.                                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps exact deletion behavior behind the owning feature boundary.                      │
 * │ - Preserves durable identities without retaining private captured content.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native Workflow owns execution; public participants coordinate synchronous feature       │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createHash } from 'node:crypto';

import { StudyError, errorKindSchema } from '@study/contracts/errors';
import { materialIdSchema } from '@study/contracts/ids';
import type { MaterialId } from '@study/contracts/ids';
import {
  materialDeletionSchema,
  materialDeletionPreviewSchema,
  requestMaterialDeletionSchema
} from '@study/contracts/materials/deletion';
import { eq, inArray, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema, Option } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

import { makeContent } from './content.ts';

function makeDeletion({ db, clock }: StoreResources) {
  function status(id: MaterialId) {
    const member = db.orm
      .select()
      .from(s.material_deletion_members)
      .where(eq(s.material_deletion_members.material_id, id))
      .get();

    const row = db.orm
      .select()
      .from(s.material_deletions)
      .where(eq(s.material_deletions.material_id, member?.deletion_id ?? id))
      .get();

    if (!row) throw new StudyError('not_found', 'Material deletion is unavailable');

    return {
      materialId: row.material_id,
      operationId: row.operation_id,
      materialIds: Schema.decodeUnknownSync(
        Schema.fromJsonString(Schema.toCodecJson(Schema.Array(materialIdSchema)))
      )(row.selection),
      status: row.status,
      phase: row.phase,
      attempt: Number(row.attempt),
      errorKind:
        row.error_kind === null ? null : Schema.decodeUnknownSync(errorKindSchema)(row.error_kind),
      completedAt: row.completed_at
    };
  }

  function replayScope(input: typeof requestMaterialDeletionSchema.Type) {
    const previous = status(input.materialId);
    const requested = [input.materialId, ...input.descendantIds];

    if (
      previous.materialId !== input.materialId ||
      requested.length !== previous.materialIds.length ||
      requested.some((id) => !previous.materialIds.includes(id))
    )
      throw new StudyError('invalid_input', 'Overlapping deletion has a different scope');

    return previous;
  }

  function preview(id: MaterialId) {
    if (!db.orm.select().from(s.materials).where(eq(s.materials.id, id)).get())
      throw new StudyError('not_found', 'Material is unavailable');

    if (
      db.orm
        .select()
        .from(s.material_deletion_members)
        .where(eq(s.material_deletion_members.material_id, id))
        .get()
    )
      throw new StudyError('invalid_input', 'Material deletion already accepted');

    const versions = db.orm.select().from(s.material_versions).all();

    const edges = db.orm.select().from(s.material_version_inputs).all();

    const byId = new Map(versions.map((v) => [v.id, v.material_id]));

    const found = new Set<MaterialId>([id]);

    for (;;) {
      const size = found.size;

      for (const e of edges)
        if (found.has(byId.get(e.input_version_id)!)) found.add(byId.get(e.version_id)!);

      if (size === found.size) break;
    }

    const descendants = [...found].filter((x) => x !== id).sort((a, b) => (a < b ? -1 : 1));

    const selectedVersions = versions.filter((v) => found.has(v.material_id));

    const versionIds = selectedVersions.map((v) => v.id);

    const references = edges
      .filter((e) => found.has(byId.get(e.input_version_id)!))
      .map((e) => ({
        dependentMaterialId: byId.get(e.version_id)!,
        inputVersionId: e.input_version_id
      }));

    const imports = db.orm
      .select()
      .from(s.material_imports)
      .where(inArray(s.material_imports.material_id, [...found]))
      .all();

    const assets = db.orm.select().from(s.document_assets).all();

    const generation = db.orm
      .select()
      .from(s.material_generation_inputs)
      .where(inArray(s.material_generation_inputs.version_id, versionIds))
      .all();

    const memberships = db.orm
      .select()
      .from(s.session_materials)
      .where(inArray(s.session_materials.material_id, [...found]))
      .all();

    const value = {
      materialId: id,
      descendants,
      materials: [...found].map((materialId) => ({
        materialId,
        versionIds: versions.filter((v) => v.material_id === materialId).map((v) => v.id),
        unavailable:
          db.orm
            .select()
            .from(s.material_deletion_members)
            .where(eq(s.material_deletion_members.material_id, materialId))
            .get() !== undefined
      })),
      missingEvidence: 'exact_deleted_input_versions' as const,
      versionIds,
      references,
      sourceIds: imports.map((x) => x.source_id),
      sharedImageSourceIds: [
        ...new Set(
          assets
            .filter((x) => imports.some((i) => i.source_id === x.source_id))
            .map((x) => x.source_id)
        )
      ],
      sessionIds: [...new Set(memberships.map((x) => x.session_id))],
      retainedMessageCitationCount: 0,
      privateRequestIds: [
        ...new Set([
          ...generation.map((x) => x.request_id),
          ...selectedVersions.flatMap((v) =>
            v.generation_request_id === null ? [] : [v.generation_request_id]
          )
        ])
      ],
      retainedCopies: 'unselected_materials_and_published_messages_including_recordings' as const
    };

    const token = createHash('sha256')
      .update(
        JSON.stringify({ value, selectedVersions, edges, assets }, (_, v) =>
          typeof v === 'bigint' ? String(v) : v
        )
      )
      .digest('hex');

    return { ...value, token };
  }

  return { status, preview, replayScope, db, clock };
}

export const MaterialDeletionStore = defineStore({
  name: 'study/MaterialDeletionStore',
  entity: { singular: 'materialDeletion', plural: 'materialDeletions' },
  make: (resources) => {
    const { status, preview, replayScope, db, clock } = makeDeletion(resources);

    const { removeContent } = makeContent(resources);

    return {
      queries: {
        findMaterialDeletion: storeQuery({
          role: 'optional',
          input: materialIdSchema,
          output: Schema.Option(materialDeletionSchema),
          run: (id) => {
            const member = db.orm
              .select()
              .from(s.material_deletion_members)
              .where(eq(s.material_deletion_members.material_id, id))
              .get();

            return member ? Option.some(status(id)) : Option.none();
          }
        }),
        materialDeletion: storeQuery({
          role: 'required',
          input: materialIdSchema,
          output: materialDeletionSchema,
          run: status
        })
      },
      mutations: {
        accept: storeMutation({
          input: Schema.Struct({
            ...requestMaterialDeletionSchema.fields,
            operationId: Schema.String
          }),
          output: materialDeletionSchema,
          run: (input) => {
            if (
              new Set([input.materialId, ...input.descendantIds]).size !==
              input.descendantIds.length + 1
            )
              throw new StudyError('invalid_input', 'Deletion scope contains duplicates');

            const existing = db.orm
              .select()
              .from(s.material_deletion_members)
              .where(eq(s.material_deletion_members.material_id, input.materialId))
              .get();

            if (existing) return replayScope(input);

            if (
              db.orm
                .select()
                .from(s.material_history_prunes)
                .where(
                  sql`${s.material_history_prunes.material_id} IN (${sql.join(
                    [input.materialId, ...input.descendantIds].map((id) => sql`${id}`),
                    sql`,`
                  )}) AND ${s.material_history_prunes.status} != 'completed'`
                )
                .get()
            )
              throw new StudyError('invalid_input', 'Material history cleanup is pending');

            const current = preview(input.materialId);

            if (current.token !== input.token)
              throw new StudyError('invalid_input', 'Deletion preview changed');

            const ids = [input.materialId, ...input.descendantIds];

            if (
              new Set(ids).size !== ids.length ||
              input.descendantIds.some((id) => !current.descendants.includes(id))
            )
              throw new StudyError('invalid_input', 'Deletion requires distinct known descendants');

            if (
              db.orm
                .select()
                .from(s.material_deletion_members)
                .where(inArray(s.material_deletion_members.material_id, ids))
                .get()
            )
              throw new StudyError('invalid_input', 'Deletion overlaps accepted scope');

            db.orm
              .insert(s.material_deletions)
              .values({
                material_id: input.materialId,
                operation_id: input.operationId,
                selection: JSON.stringify(ids.map(String)),
                status: 'pending',
                created_at: unixSeconds(clock)
              })
              .run();

            for (const id of ids)
              db.orm
                .insert(s.material_deletion_members)
                .values({ material_id: id, deletion_id: input.materialId })
                .run();

            return status(input.materialId);
          }
        }),
        retry: storeMutation({
          input: Schema.Struct({ materialId: materialIdSchema, pendingTerminal: Schema.Boolean }),
          output: materialDeletionSchema,
          run: (input) => {
            const previous = status(input.materialId);

            if (
              previous.status === 'failed' ||
              (previous.status === 'pending' && input.pendingTerminal)
            )
              db.orm
                .update(s.material_deletions)
                .set({ status: 'pending', error_kind: null, attempt: previous.attempt + 1 })
                .where(eq(s.material_deletions.material_id, previous.materialId))
                .run();

            return status(input.materialId);
          }
        }),
        settle: storeMutation({
          input: Schema.Struct({
            materialId: materialIdSchema,
            attempt: Schema.Int,
            errorKind: Schema.NullOr(errorKindSchema)
          }),
          output: materialDeletionSchema,
          run: (input) => {
            const previous = status(input.materialId);

            if (previous.status === 'completed' || previous.attempt !== input.attempt)
              return previous;

            db.orm
              .update(s.material_deletions)
              .set({
                status: input.errorKind === null ? 'completed' : 'failed',
                phase: input.errorKind === null ? 'completed' : previous.phase,
                error_kind: input.errorKind,
                completed_at: input.errorKind === null ? unixSeconds(clock) : null
              })
              .where(eq(s.material_deletions.material_id, previous.materialId))
              .run();

            return status(input.materialId);
          }
        }),
        scrub: storeMutation({
          input: materialIdSchema,
          output: Schema.Void,
          run: (id) => {
            const deletion = status(id);

            const versions = db.orm
              .select()
              .from(s.material_versions)
              .where(inArray(s.material_versions.material_id, [...deletion.materialIds]))
              .all();

            const versionIds = versions.map((v) => v.id);

            db.orm
              .delete(s.material_citation_assessments)
              .where(
                sql`${s.material_citation_assessments.claim_version_id} IN (${sql.join(
                  versionIds.map((v) => sql`${v}`),
                  sql`,`
                )}) OR ${s.material_citation_assessments.evidence_version_id} IN (${sql.join(
                  versionIds.map((v) => sql`${v}`),
                  sql`,`
                )})`
              )
              .run();

            const annotations = db.orm
              .select()
              .from(s.material_annotations)
              .where(inArray(s.material_annotations.material_id, [...deletion.materialIds]))
              .all();

            for (const a of annotations)
              db.orm
                .delete(s.material_annotation_revisions)
                .where(eq(s.material_annotation_revisions.annotation_id, a.id))
                .run();

            db.orm
              .delete(s.material_annotations)
              .where(inArray(s.material_annotations.material_id, [...deletion.materialIds]))
              .run();

            db.orm
              .delete(s.document_edit_receipts)
              .where(inArray(s.document_edit_receipts.material_id, [...deletion.materialIds]))
              .run();

            for (const v of versions) {
              // Incoming edges/citations belong to retained copies and preserve the exact missing identity.

              db.orm
                .delete(s.material_version_citations)
                .where(eq(s.material_version_citations.version_id, v.id))
                .run();
              removeContent(v.id);

              db.orm
                .update(s.material_versions)
                .set({ instruction: null, language: null })
                .where(eq(s.material_versions.id, v.id))
                .run();
            }

            db.orm
              .delete(s.project_materials)
              .where(inArray(s.project_materials.material_id, [...deletion.materialIds]))
              .run();

            db.orm
              .delete(s.session_materials)
              .where(inArray(s.session_materials.material_id, [...deletion.materialIds]))
              .run();

            db.orm
              .update(s.materials)
              .set({ title: '-', archived_at: unixSeconds(clock) })
              .where(inArray(s.materials.id, [...deletion.materialIds]))
              .run();

            db.orm
              .update(s.material_deletions)
              .set({ phase: 'retired' })
              .where(eq(s.material_deletions.material_id, deletion.materialId))
              .run();
          }
        })
      }
    };
  }
});

export const MaterialDeletionPreviewStore = defineStore({
  name: 'study/MaterialDeletionPreviewStore',
  entity: { singular: 'materialDeletionPreview', plural: 'materialDeletionPreviews' },
  make: (resources) => ({
    queries: {
      materialDeletionPreview: storeQuery({
        role: 'required',
        input: materialIdSchema,
        output: materialDeletionPreviewSchema,
        run: makeDeletion(resources).preview
      })
    },
    mutations: {}
  })
});
