/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Retires exact generated Document bodies without transferring raw session           │
 * │ ownership.                                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Retires exact generated Document bodies without transferring raw session ownership.    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside Documents ownership; callers own            │
 * │ transaction scope.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { studyDocumentVersionIdSchema } from '@study/contracts/ids';
import { sql } from '@study/db';
import { Schema } from 'effect';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';

export const DocumentBodyRetirementStore = defineStore({
  name: 'study/DocumentBodyRetirementStore',
  entity: { singular: 'bodyRetirementCorrelation', plural: 'bodyRetirementCorrelations' },
  make: ({ db }) => ({
    queries: {
      bodyRetirementCorrelation: storeQuery({
        role: 'required',
        input: Schema.Array(studyDocumentVersionIdSchema),
        output: Schema.Struct({ ids: Schema.Array(Schema.String) }),
        run: (ids) => ({
          ids: ids.length
            ? db.orm
                .all<{ id: string }>(sql`
            SELECT id FROM study_document_transform_requests WHERE result_version_id IN ${ids}
            UNION SELECT id FROM study_document_generation_requests WHERE result_version_id IN ${ids}
          `)
                .map((row) => row.id)
            : []
        })
      })
    },
    mutations: {}
  })
});
