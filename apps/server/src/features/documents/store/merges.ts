import * as t from '@study/contracts/documents/transform';
import { projectIdSchema } from '@study/contracts/ids';
import { and, desc, eq, isNull, sql } from '@study/db';
import { study_document_transform_requests as requests } from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';

import { decodeTransformRequest } from './transforms.ts';

/** Pending merges remain reachable independently of completed history. */
export const DocumentMergesStore = defineStore({
  name: 'study/DocumentMergesStore',
  entity: { singular: 'merge', plural: 'merges' },
  make: ({ db }) => ({
    queries: {
      merges: storeQuery({
        role: 'collection',
        input: Schema.Struct({ projectId: Schema.optional(projectIdSchema) }),
        output: Schema.Array(t.transformSnapshotSchema),
        run: ({ projectId }) => {
          const scope = and(
            isNull(requests.session_id),
            eq(requests.cancelled, false),
            sql`json_type(${requests.request}, '$.merge') = 'object'`,
            projectId === undefined
              ? undefined
              : sql`json_extract(${requests.request}, '$.merge.projectId') = ${String(projectId)}`
          );
          const pending = db.orm
            .select()
            .from(requests)
            .where(and(scope, isNull(requests.result_version_id)))
            .orderBy(desc(requests.created_at), desc(requests.id))
            .all();
          const completed = db.orm
            .select()
            .from(requests)
            .where(and(scope, sql`${requests.result_version_id} IS NOT NULL`))
            .orderBy(desc(requests.created_at), desc(requests.id))
            .limit(3)
            .all();
          return [...pending, ...completed].map(decodeTransformRequest);
        }
      })
    },
    mutations: {}
  })
});
