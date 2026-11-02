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
import { eq } from '@study/db';
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
      const ids = retirement.affectedRequests(versionIds, contextIds).map((request) => request.id);

      const ownedIds: string[] = [];

      for (const id of ids) {
        const owner = db.orm
          .select({
            kind: s.material_history_requests.kind,
            status: s.material_history_prunes.status
          })
          .from(s.material_history_requests)
          .innerJoin(
            s.material_history_prunes,
            eq(s.material_history_prunes.operation_id, s.material_history_requests.operation_id)
          )
          .where(eq(s.material_history_requests.request_id, id))
          .get();

        if (owner) {
          if (
            owner.kind === 'generation' &&
            owner.status === 'completed' &&
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
          run: (id) => retirement.scrubOwnedRequests({ kind: 'history', id })
        })
      }
    };
  }
});
