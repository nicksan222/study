/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Retires only generation requests whose exact inputs or output belong to accepted   │
 * │ deletion.                                                                                │
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

import { StudyError } from '@study/contracts/errors';
import { materialIdSchema } from '@study/contracts/ids';
import { materialGenerationPayloadSchema } from '@study/contracts/materials/schemas';
import { eq, inArray, and, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation } from '#server/platform/definitions/define-store';

import { makeProposalRetirement } from './session-retirement.ts';

export const MaterialDeletionGenerationStore = defineStore({
  name: 'study/MaterialDeletionGenerationStore',
  entity: { singular: 'materialDeletionGeneration', plural: 'materialDeletionGenerations' },
  make: (resources) => {
    const { db } = resources;

    const retireProposal = makeProposalRetirement(resources);

    function alreadyScrubbed(requestId: string, ownerId: typeof materialIdSchema.Type) {
      const owner = db.orm
        .select()
        .from(s.material_deletions)
        .where(eq(s.material_deletions.material_id, ownerId))
        .get();

      const request = db.orm
        .select()
        .from(s.material_generation_requests)
        .where(eq(s.material_generation_requests.id, requestId))
        .get();

      const input = db.orm
        .select()
        .from(s.material_generation_inputs)
        .where(eq(s.material_generation_inputs.request_id, requestId))
        .get();

      return (
        owner?.status === 'completed' &&
        owner.phase === 'completed' &&
        request?.payload === '{}' &&
        request.cancelled &&
        request.result_metadata === null &&
        request.result_version_id === null &&
        request.result_hash === null &&
        !input
      );
    }

    return {
      queries: {},
      mutations: {
        prepare: storeMutation({
          input: Schema.Struct({
            deletionId: materialIdSchema,
            contextIds: Schema.Array(Schema.String)
          }),
          output: Schema.Array(Schema.String),
          run: ({ deletionId, contextIds }) => {
            const members = db.orm
              .select()
              .from(s.material_deletion_members)
              .where(eq(s.material_deletion_members.deletion_id, deletionId))
              .all()
              .map((x) => x.material_id);

            const versions = db.orm
              .select()
              .from(s.material_versions)
              .where(inArray(s.material_versions.material_id, members))
              .all();

            const inputs = db.orm
              .select()
              .from(s.material_generation_inputs)
              .where(
                inArray(
                  s.material_generation_inputs.version_id,
                  versions.map((v) => v.id)
                )
              )
              .all();

            const requests = db.orm.select().from(s.material_generation_requests).all();

            const ids = requests
              .filter(
                (r) =>
                  inputs.some((i) => i.request_id === r.id) ||
                  versions.some((v) => v.generation_request_id === r.id) ||
                  (r.payload !== '{}' &&
                    contextIds.includes(
                      Schema.decodeUnknownSync(
                        Schema.fromJsonString(Schema.toCodecJson(materialGenerationPayloadSchema))
                      )(r.payload).documentTransform?.contextRequestId ?? ''
                    ))
              )
              .map((r) => r.id);

            const ownedIds: string[] = [];

            for (const id of ids) {
              const owner = db.orm
                .select()
                .from(s.material_deletion_requests)
                .where(eq(s.material_deletion_requests.request_id, id))
                .get();

              if (owner?.kind === 'generation' && alreadyScrubbed(id, owner.deletion_id)) continue;

              if (owner)
                throw new StudyError(
                  'invalid_input',
                  'Deletion overlaps generation cleanup ownership'
                );

              db.orm
                .insert(s.material_deletion_requests)
                .values({ request_id: id, deletion_id: deletionId, kind: 'generation' })
                .run();

              ownedIds.push(id);
            }

            return ownedIds;
          }
        }),
        scrub: storeMutation({
          input: materialIdSchema,
          output: Schema.Void,
          run: (id) => {
            const requests = db.orm
              .select()
              .from(s.material_deletion_requests)
              .where(eq(s.material_deletion_requests.deletion_id, id))
              .all()
              .filter((x) => x.kind === 'generation');

            for (const r of requests) {
              retireProposal(r.request_id);

              db.orm
                .update(s.material_versions)
                .set({ instruction: null })
                .where(
                  and(
                    eq(s.material_versions.generation_request_id, r.request_id),
                    sql`${s.material_versions.instruction} IS (SELECT json_extract(payload,'$.instruction') FROM material_generation_requests WHERE id=${r.request_id})`
                  )
                )
                .run();

              db.orm
                .update(s.material_generation_requests)
                .set({
                  payload: '{}',
                  result_metadata: null,
                  cancelled: true,
                  result_version_id: null,
                  result_hash: null
                })
                .where(eq(s.material_generation_requests.id, r.request_id))
                .run();

              db.orm
                .delete(s.material_generation_inputs)
                .where(eq(s.material_generation_inputs.request_id, r.request_id))
                .run();
            }
          }
        })
      }
    };
  }
});
