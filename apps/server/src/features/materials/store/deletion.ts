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
import { CryptoHasher } from 'bun';
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
    const requested = [input.materialId];

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

    const versions = db.orm
      .select()
      .from(s.material_versions)
      .where(eq(s.material_versions.material_id, id))
      .all();
    const memberships = db.orm
      .select()
      .from(s.note_materials)
      .where(eq(s.note_materials.material_id, id))
      .all();
    const value = {
      materialId: id,
      versionIds: versions.map((version) => version.id),
      noteIds: memberships.map((link) => link.note_id),
      privateRequestIds: [
        ...new Set(
          versions.flatMap((version) =>
            version.generation_request_id === null ? [] : [version.generation_request_id]
          )
        )
      ]
    };
    const token = new CryptoHasher('sha256')
      .update(
        JSON.stringify({ value, versions }, (_, item) =>
          typeof item === 'bigint' ? String(item) : item
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
                    [input.materialId].map((id) => sql`${id}`),
                    sql`,`
                  )}) AND ${s.material_history_prunes.status} != 'completed'`
                )
                .get()
            )
              throw new StudyError('invalid_input', 'Material history cleanup is pending');

            const current = preview(input.materialId);

            if (current.token !== input.token)
              throw new StudyError('invalid_input', 'Deletion preview changed');

            const ids = [input.materialId];

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

            for (const v of versions) {
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
              .delete(s.note_materials)
              .where(inArray(s.note_materials.material_id, [...deletion.materialIds]))
              .run();

            db.orm
              .update(s.materials)
              .set({
                title: '-',
                description: null,
                creation_intent: sql`CASE WHEN create_key IS NULL THEN NULL ELSE '{}' END`,
                archived_at: unixSeconds(clock)
              })
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
