/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Proves exact generation ownership for accepted historical inputs and outputs.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Rejects overlapping owners until the entire prior generation cleanup is complete.      │
 * │ - Delegates private payload retirement to the shared Material retirement writer.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ This store owns history proofs; native checkpoint writes remain behind Workflows.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { materialVersionIdSchema } from '@study/contracts/ids';
import { eq, inArray, and } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation } from '#server/platform/definitions/define-store';

import { makeGenerationRetirement } from './generation-retirement.ts';

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

    const retirement = makeGenerationRetirement(resources);

    function prepare({ operationId, versionIds, contextIds }: typeof prepareSchema.Type) {
      const versions = db.orm
        .select()
        .from(s.material_versions)
        .where(inArray(s.material_versions.id, [...versionIds]))
        .all();

      const ids = retirement.affectedRequests(versions, contextIds).map((request) => request.id);

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

          if (
            owner.kind === 'generation' &&
            prior?.status === 'completed' &&
            retirement.isScrubbed(id)
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
              retirement.scrubRequest(r.request_id);
            }
          }
        })
      }
    };
  }
});
