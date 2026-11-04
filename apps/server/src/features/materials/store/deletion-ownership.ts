/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Content-free ownership needed to resume exact cleanup after restart.               │
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

import { defineStore, storeQuery, storeMutation } from '#server/platform/definitions/define-store';
import { decodeEvent } from '#server/platform/workflows/events';

export const MaterialDeletionOwnershipStore = defineStore({
  name: 'study/MaterialDeletionOwnershipStore',
  entity: { singular: 'materialDeletionOwnership', plural: 'materialDeletionOwnerships' },
  make: ({ db }) => ({
    queries: {
      materialDeletionOwnership: storeQuery({
        role: 'required',
        input: materialIdSchema,
        output: Schema.Struct({
          publicationIds: Schema.Array(Schema.String),
          requestIds: Schema.Array(Schema.String)
        }),
        run: (id) => ({
          publicationIds: db.orm
            .select()
            .from(s.workflowEvents)
            .where(inArray(s.workflowEvents.type, ['MaterialPublished']))
            .all()
            .filter((e) => {
              if (e.payload === '{}') return false;

              const p = decodeEvent(e.payload);

              if (p.type !== 'MaterialPublished') return false;

              return db.orm
                .select()
                .from(s.material_deletion_members)
                .where(eq(s.material_deletion_members.deletion_id, id))
                .all()
                .some((m) => m.material_id === p.materialId);
            })
            .map((e) => e.correlationId),
          requestIds: db.orm
            .select()
            .from(s.material_deletion_requests)
            .where(eq(s.material_deletion_requests.deletion_id, id))
            .all()
            .map((r) => r.request_id)
        })
      })
    },
    mutations: {
      retain: storeMutation({
        input: Schema.Struct({
          deletionId: materialIdSchema,
          requestIds: Schema.Array(Schema.String),
          kind: Schema.Literals(['learning', 'publication'])
        }),
        output: Schema.Void,
        run: ({ deletionId, requestIds, kind }) => {
          for (const requestId of requestIds) {
            const previous = db.orm
              .select()
              .from(s.material_deletion_requests)
              .where(eq(s.material_deletion_requests.request_id, requestId))
              .get();

            if (previous && previous.deletion_id !== deletionId)
              throw new StudyError('invalid_input', 'Deletion overlaps private cleanup ownership');

            // Kind is first-claim provenance; the correlation has one global owner.
            // Each participant resolves its own persisted rows under that owner.
            if (previous) continue;

            db.orm
              .insert(s.material_deletion_requests)
              .values({ request_id: requestId, deletion_id: deletionId, kind })
              .onConflictDoNothing()
              .run();
          }
        }
      })
    }
  })
});
