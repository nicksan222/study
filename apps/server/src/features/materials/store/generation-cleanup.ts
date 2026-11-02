/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Proves exact generation ownership for accepted deletion and history scopes.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Rejects overlapping owners until the entire prior generation cleanup is complete.      │
 * │ - Delegates private payload retirement to the shared Material retirement writer.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ This store owns cleanup proofs; native checkpoint writes remain behind Workflows.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { materialIdSchema, materialVersionIdSchema } from '@study/contracts/ids';
import { eq, inArray } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation } from '#server/platform/definitions/define-store';

import { makeGenerationRetirement } from './generation-retirement.ts';

const deletionScopeSchema = Schema.Struct({
  kind: Schema.Literal('deletion'),
  id: materialIdSchema
});

const historyScopeSchema = Schema.Struct({ kind: Schema.Literal('history'), id: Schema.String });

const scopeSchema = Schema.Union([deletionScopeSchema, historyScopeSchema]);

const prepareSchema = Schema.Union([
  Schema.Struct({ ...deletionScopeSchema.fields, contextIds: Schema.Array(Schema.String) }),
  Schema.Struct({
    ...historyScopeSchema.fields,
    versionIds: Schema.Array(materialVersionIdSchema),
    contextIds: Schema.Array(Schema.String)
  })
]);

export const MaterialGenerationCleanupStore = defineStore({
  name: 'study/MaterialGenerationCleanupStore',
  entity: { singular: 'materialGenerationCleanup', plural: 'materialGenerationCleanups' },
  make: (resources) => {
    const { db } = resources;
    const retirement = makeGenerationRetirement(resources);

    function selectedVersions(scope: typeof prepareSchema.Type) {
      if (scope.kind === 'history') return scope.versionIds;

      const members = db.orm
        .select({ id: s.material_deletion_members.material_id })
        .from(s.material_deletion_members)
        .where(eq(s.material_deletion_members.deletion_id, scope.id));

      return db.orm
        .select({ id: s.material_versions.id })
        .from(s.material_versions)
        .where(inArray(s.material_versions.material_id, members))
        .all()
        .map((version) => version.id);
    }

    function deletionOwner(requestId: string) {
      const owner = db.orm
        .select({
          kind: s.material_deletion_requests.kind,
          status: s.material_deletions.status,
          phase: s.material_deletions.phase
        })
        .from(s.material_deletion_requests)
        .leftJoin(
          s.material_deletions,
          eq(s.material_deletions.material_id, s.material_deletion_requests.deletion_id)
        )
        .where(eq(s.material_deletion_requests.request_id, requestId))
        .get();

      return (
        owner && {
          kind: owner.kind,
          completed: owner.status === 'completed' && owner.phase === 'completed'
        }
      );
    }

    function historyOwner(requestId: string) {
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
        .where(eq(s.material_history_requests.request_id, requestId))
        .get();

      return owner && { kind: owner.kind, completed: owner.status === 'completed' };
    }

    function prepare(scope: typeof prepareSchema.Type) {
      const requests = retirement.affectedRequests(selectedVersions(scope), scope.contextIds);
      const ownedIds: string[] = [];

      for (const request of requests) {
        const owner =
          scope.kind === 'deletion' ? deletionOwner(request.id) : historyOwner(request.id);

        if (owner) {
          if (owner.kind === 'generation' && owner.completed && retirement.isScrubbed(request.id))
            continue;

          throw new StudyError('invalid_input', 'Cleanup overlaps generation ownership');
        }

        retirement.retainRequest(scope, request.id);
        ownedIds.push(request.id);
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
          input: scopeSchema,
          output: Schema.Void,
          run: retirement.scrubOwnedRequests
        })
      }
    };
  }
});
