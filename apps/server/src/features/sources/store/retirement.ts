/** Source retirement also removes private native processing captures. */
import { sourceIdSchema } from '@study/contracts/ids';
import { sourceDeletionPreviewSchema } from '@study/contracts/sources/rpc';
import { eq, sql } from '@study/db';
import { sources } from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';

import { sourceDeletionBlockers } from './retention.ts';

export const SourceRetirementStore = defineStore({
  name: 'study/SourceRetirementStore',
  entity: { singular: 'sourceRetirement', plural: 'sourceRetirements' },
  make: ({ db }) => ({
    queries: {
      sourceRetirement: storeQuery({
        role: 'required',
        input: sourceIdSchema,
        output: Schema.Struct({ ids: Schema.Array(Schema.String) }),
        run: (id) => ({
          ids: db.orm
            .all<{ id: string }>(sql`
            SELECT request_id AS id FROM source_processing WHERE source_id=${id}
            UNION SELECT published_request_id FROM source_processing WHERE source_id=${id} AND published_request_id IS NOT NULL
            UNION SELECT correlation_id FROM workflow_events
              WHERE type IN ('SourceProcessingRequested','SourceCorrectionRequested','SourceProcessingFailed','SourceIndexed','SourceProjectChanged')
              AND CAST(json_extract(payload,'$.sourceId') AS TEXT)=${String(id)}
            UNION SELECT json_extract(payload,'$.event.correlationId') FROM workflow_executions
              WHERE json_extract(payload,'$.event.type') IN ('SourceProcessingRequested','SourceCorrectionRequested')
              AND CAST(json_extract(payload,'$.event.sourceId') AS TEXT)=${String(id)}
          `)
            .map((row) => row.id)
        })
      })
    },
    mutations: {}
  })
});

export const SourceDeletionPreviewStore = defineStore({
  name: 'study/SourceDeletionPreviewStore',
  entity: { singular: 'sourceDeletion', plural: 'sourceDeletions' },
  make: (resources) => ({
    queries: {
      sourceDeletion: storeQuery({
        role: 'required',
        input: sourceIdSchema,
        output: sourceDeletionPreviewSchema,
        run: (id) => {
          const source = resources.db.orm.select().from(sources).where(eq(sources.id, id)).get();
          if (!source) return undefined;
          return {
            sourceId: id,
            name: source.name,
            revisionCount: resources.db.orm.get<{ n: bigint }>(
              sql`SELECT count(*) n FROM source_snapshots WHERE source_id=${id}`
            )!.n,
            extractionCount: resources.db.orm.get<{ n: bigint }>(
              sql`SELECT count(*) n FROM source_extraction_revisions WHERE source_id=${id}`
            )!.n,
            blockedBy: sourceDeletionBlockers(resources, id),
            retainedCopies: 'authored_outputs_and_raw_session_records' as const
          };
        }
      })
    },
    mutations: {}
  })
});
