/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Retires only generation requests whose exact inputs or output belong to accepted   │
 * │ deletion.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps exact history behavior behind the owning feature boundary.                      │
 * │ - Preserves durable identities without retaining private captured content.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native Workflow owns execution; public participants coordinate synchronous feature       │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { materialVersionIdSchema } from '@study/contracts/ids';
import { materialGenerationPayloadSchema } from '@study/contracts/materials/schemas';
import { eq, inArray, and, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation } from '#server/platform/definitions/define-store';

import { makeProposalRetirement } from './session-retirement.ts';

const prepareSchema = Schema.Struct({
  operationId: Schema.String,
  versionIds: Schema.Array(materialVersionIdSchema),
  contextIds: Schema.Array(Schema.String)
});

export const MaterialHistoryGenerationStore = defineStore({
  name: 'study/MaterialHistoryGenerationStore',
  entity: { singular: 'materialHistoryGeneration', plural: 'materialHistoryGenerations' },
  make: (resources) => {
    const { db } = resources;

    const retireProposal = makeProposalRetirement(resources);

    function prepare({ operationId, versionIds, contextIds }: typeof prepareSchema.Type) {
      const versions = db.orm
        .select()
        .from(s.material_versions)
        .where(inArray(s.material_versions.id, [...versionIds]))
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
          .from(s.material_history_requests)
          .where(eq(s.material_history_requests.request_id, id))
          .get();
        if (owner) {
          const prior = db.orm
            .select()
            .from(s.material_history_prunes)
            .where(eq(s.material_history_prunes.operation_id, owner.operation_id))
            .get();
          const request = requests.find((value) => value.id === id);
          const hasInputs =
            db.orm
              .select()
              .from(s.material_generation_inputs)
              .where(eq(s.material_generation_inputs.request_id, id))
              .get() !== undefined;

          if (
            owner.kind === 'generation' &&
            prior?.status === 'completed' &&
            request?.payload === '{}' &&
            request.cancelled &&
            request.result_metadata === null &&
            request.result_version_id === null &&
            request.result_hash === null &&
            !hasInputs
          )
            continue;
          throw new StudyError('invalid_input', 'History overlaps generation cleanup');
        }
        db.orm
          .insert(s.material_history_requests)
          .values({ request_id: id, operation_id: operationId, kind: 'generation' })
          .run();
        ownedIds.push(id);
      }
      return ownedIds;
    }

    return {
      queries: {},
      mutations: {
        prepare: storeMutation({
          input: prepareSchema,
          output: Schema.Array(Schema.String),
          run: prepare
        }),
        scrub: storeMutation({
          input: Schema.String,
          output: Schema.Void,
          run: (id) => {
            const requests = db.orm
              .select({ request_id: s.material_history_requests.request_id })
              .from(s.material_history_requests)
              .where(
                and(
                  eq(s.material_history_requests.operation_id, id),
                  eq(s.material_history_requests.kind, 'generation')
                )
              )
              .all();

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
