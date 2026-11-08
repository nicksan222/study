/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Retires exact generated Page bodies without transferring raw note                  │
 * │ ownership.                                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Retires exact generated Page bodies without transferring raw note ownership.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside Pages ownership; callers own                │
 * │ transaction scope.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { pageVersionIdSchema } from '@study/contracts/ids';
import { sql } from '@study/db';
import { Schema } from 'effect';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';

export const PageBodyRetirementStore = defineStore({
  name: 'study/PageBodyRetirementStore',
  entity: { singular: 'bodyRetirementCorrelation', plural: 'bodyRetirementCorrelations' },
  make: ({ db }) => ({
    queries: {
      bodyRetirementCorrelation: storeQuery({
        role: 'required',
        input: Schema.Array(pageVersionIdSchema),
        output: Schema.Struct({ ids: Schema.Array(Schema.String) }),
        run: (ids) => ({
          ids: ids.length
            ? db.orm
                .all<{ id: string }>(sql`
            SELECT id FROM page_transform_requests WHERE result_version_id IN ${ids}
            UNION SELECT id FROM page_generation_requests WHERE result_version_id IN ${ids}
          `)
                .map((row) => row.id)
            : []
        })
      })
    },
    mutations: {}
  })
});
