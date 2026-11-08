/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reads pending document merges and recent completed publication history.            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Read bounded pages without losing pending merge requests.                              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous queries stay within Pages persistence and caller owned scope.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { projectIdSchema } from '@study/contracts/ids';
import * as t from '@study/contracts/pages/transform';
import { and, desc, eq, isNull, sql } from '@study/db';
import { page_transform_requests as requests } from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';

import { decodeTransformRequest } from './transforms.ts';

/** Pending merges remain reachable independently of completed history. */
export const PageMergesStore = defineStore({
  name: 'study/PageMergesStore',
  entity: { singular: 'merge', plural: 'merges' },
  make: ({ db }) => ({
    queries: {
      merges: storeQuery({
        role: 'collection',
        input: Schema.Struct({
          projectId: Schema.optional(projectIdSchema),
          pending: Schema.Boolean,
          offset: Schema.Int,
          limit: Schema.Int
        }),
        output: Schema.Array(t.transformSnapshotSchema),
        run: ({ projectId, pending, offset, limit }) => {
          const scope = and(
            isNull(requests.note_id),
            eq(requests.cancelled, false),
            sql`json_type(${requests.request}, '$.merge') = 'object'`,
            projectId === undefined
              ? undefined
              : sql`json_extract(${requests.request}, '$.merge.projectId') = ${String(projectId)}`
          );

          return db.orm
            .select()
            .from(requests)
            .where(
              and(
                scope,
                pending
                  ? isNull(requests.result_version_id)
                  : sql`${requests.result_version_id} IS NOT NULL`
              )
            )
            .orderBy(desc(requests.created_at), desc(requests.id))
            .offset(offset)
            .limit(limit)
            .all()
            .map(decodeTransformRequest);
        }
      })
    },
    mutations: {}
  })
});
