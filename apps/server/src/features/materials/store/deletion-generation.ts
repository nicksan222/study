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
import { eq, inArray } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation } from '#server/platform/definitions/define-store';

import { makeGenerationRetirement } from './generation-retirement.ts';

const prepareSchema = Schema.Struct({
  deletionId: materialIdSchema,
  contextIds: Schema.Array(Schema.String)
});

export const MaterialDeletionGenerationStore = defineStore({
  name: 'study/MaterialDeletionGenerationStore',
  entity: { singular: 'materialDeletionGeneration', plural: 'materialDeletionGenerations' },
  make: (resources) => {
    const { db } = resources;

    const retirement = makeGenerationRetirement(resources);

    function alreadyScrubbed(requestId: string, ownerId: typeof materialIdSchema.Type) {
      const owner = db.orm
        .select()
        .from(s.material_deletions)
        .where(eq(s.material_deletions.material_id, ownerId))
        .get();

      return (
        owner?.status === 'completed' &&
        owner.phase === 'completed' &&
        retirement.isScrubbed(requestId)
      );
    }

    function prepare({ deletionId, contextIds }: typeof prepareSchema.Type) {
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
        .all()
        .map((version) => version.id);

      const ids = retirement.affectedRequests(versions, contextIds).map((request) => request.id);

      const ownedIds: string[] = [];

      for (const id of ids) {
        const owner = db.orm
          .select({
            deletion_id: s.material_deletion_requests.deletion_id,
            kind: s.material_deletion_requests.kind
          })
          .from(s.material_deletion_requests)
          .where(eq(s.material_deletion_requests.request_id, id))
          .get();

        if (owner?.kind === 'generation' && alreadyScrubbed(id, owner.deletion_id)) continue;

        if (owner)
          throw new StudyError('invalid_input', 'Deletion overlaps generation cleanup ownership');

        retirement.retainRequest({ kind: 'deletion', id: deletionId }, id);

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
        scrub: retirement.deletionScrub
      }
    };
  }
});
