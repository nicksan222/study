/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Retires exact extraction bodies while retaining original byte revisions.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Retires exact extraction bodies while retaining original byte revisions.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside its feature; callers own transaction scope. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createHash } from 'node:crypto';

import { StudyError } from '@study/contracts/errors';
import { contentSnapshotIdSchema, sourceIdSchema } from '@study/contracts/ids';
import type { ContentSnapshotId } from '@study/contracts/ids';
import {
  sourceHistoryInputSchema,
  sourceHistoryPreviewSchema,
  sourceHistoryRetireSchema
} from '@study/contracts/sources/rpc';
import { and, asc, eq, inArray, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';

export const SourceHistoryStore = defineStore({
  name: 'study/SourceHistoryStore',
  entity: { singular: 'sourceHistory', plural: 'sourceHistories' },
  make: ({ db }) => {
    function pinned(snapshotId: ContentSnapshotId) {
      return !!db.orm.get(sql`SELECT 1 FROM (
    SELECT snapshot_id FROM session_context_sources
    UNION ALL SELECT snapshot_id FROM conversation_reply_sources
    UNION ALL SELECT source_snapshot_id FROM study_document_inputs
    UNION ALL SELECT source_snapshot_id FROM material_evidence_inputs
    UNION ALL SELECT source_snapshot_id FROM learning_practice_inputs
    UNION ALL SELECT document_id FROM source_processing
    UNION ALL SELECT document_id FROM citations
   ) WHERE snapshot_id=${snapshotId} LIMIT 1`);
    }

    function preview(input: typeof sourceHistoryInputSchema.Type) {
      const source = db.orm.select().from(s.sources).where(eq(s.sources.id, input.sourceId)).get();

      if (!source) throw new StudyError('not_found', 'Source not found');

      const current = db.orm
        .select()
        .from(s.source_processing)
        .where(eq(s.source_processing.source_id, input.sourceId))
        .get();
      const candidates = db.orm
        .select({
          sourceId: s.source_extraction_revisions.source_id,
          revision: s.source_extraction_revisions.revision,
          snapshotId: s.source_extraction_revisions.snapshot_id,
          createdAt: s.content_snapshots.created_at
        })
        .from(s.source_extraction_revisions)
        .innerJoin(
          s.content_snapshots,
          eq(s.content_snapshots.id, s.source_extraction_revisions.snapshot_id)
        )
        .where(
          and(
            eq(s.source_extraction_revisions.source_id, input.sourceId),
            input.snapshotId === undefined
              ? undefined
              : eq(s.source_extraction_revisions.snapshot_id, input.snapshotId),
            sql`${s.source_extraction_revisions.snapshot_id} NOT IN (SELECT snapshot_id FROM source_extraction_revisions WHERE source_id=${input.sourceId} ORDER BY snapshot_id DESC LIMIT ${input.keepLatest})`
          )
        )
        .orderBy(asc(s.source_extraction_revisions.snapshot_id))
        .limit(100)
        .all();
      const value = {
        sourceId: input.sourceId,
        keepLatest: input.keepLatest,
        ...(input.snapshotId === undefined ? {} : { snapshotId: input.snapshotId }),
        name: source.name,
        candidates,
        blockedSnapshotIds: candidates
          .filter((item) => pinned(item.snapshotId))
          .map((item) => item.snapshotId),
        semantics: 'retire_extractions_keep_original_revisions' as const
      };
      const token = createHash('sha256')
        .update(
          JSON.stringify({ value, current }, (_, v) => (typeof v === 'bigint' ? String(v) : v))
        )
        .digest('hex');

      return { ...value, token };
    }

    return {
      queries: {
        sourceHistory: storeQuery({
          role: 'required',
          input: sourceHistoryInputSchema,
          output: sourceHistoryPreviewSchema,
          run: preview
        })
      },
      mutations: {
        retireSourceHistory: storeMutation({
          input: sourceHistoryRetireSchema,
          output: sourceHistoryPreviewSchema,
          run: (input) => {
            const impact = preview({
              sourceId: input.sourceId,
              keepLatest: input.keepLatest,
              ...(input.snapshotId === undefined ? {} : { snapshotId: input.snapshotId })
            });

            if (impact.token !== input.token)
              throw new StudyError('invalid_input', 'Source history preview changed');

            if (impact.blockedSnapshotIds.length)
              throw new StudyError(
                'invalid_input',
                'Exact evidence retains source extraction history'
              );

            const ids = impact.candidates.map((item) => item.snapshotId);

            if (ids.length) {
              db.orm
                .delete(s.source_extraction_revisions)
                .where(
                  and(
                    eq(s.source_extraction_revisions.source_id, input.sourceId),
                    inArray(s.source_extraction_revisions.snapshot_id, ids)
                  )
                )
                .run();
              db.orm.delete(s.content_snapshots).where(inArray(s.content_snapshots.id, ids)).run();
            }

            return impact;
          }
        })
      }
    };
  }
});

/** Completed captures can own a retired output or the before text of a correction. */
export const SourceHistoryRetirementStore = defineStore({
  name: 'study/SourceHistoryRetirementStore',
  entity: { singular: 'retiredExtractionCorrelation', plural: 'retiredExtractionCorrelations' },
  make: ({ db }) => ({
    queries: {
      retiredExtractionCorrelation: storeQuery({
        role: 'required',
        input: Schema.Struct({
          sourceId: sourceIdSchema,
          snapshotIds: Schema.Array(contentSnapshotIdSchema)
        }),
        output: Schema.Struct({
          ids: Schema.Array(Schema.String),
          inputIds: Schema.Array(Schema.String)
        }),
        run: ({ sourceId, snapshotIds }) => ({
          ids: snapshotIds.length
            ? db.orm
                .all<{ id: string }>(sql`
            SELECT correlation_id AS id FROM workflow_events
            WHERE CAST(json_extract(payload,'$.sourceId') AS TEXT)=${String(sourceId)}
            AND type='SourceIndexed' AND CAST(json_extract(payload,'$.documentId') AS INTEGER) IN ${snapshotIds}
          `)
                .map((row) => row.id)
            : [],
          inputIds: snapshotIds.length
            ? db.orm
                .all<{ id: string }>(sql`
              SELECT correlation_id AS id FROM workflow_events
              WHERE type='SourceCorrectionRequested'
              AND CAST(json_extract(payload,'$.sourceId') AS TEXT)=${String(sourceId)}
              AND CAST(json_extract(payload,'$.documentId') AS INTEGER) IN ${snapshotIds}
            `)
                .map((row) => row.id)
            : []
        })
      })
    },
    mutations: {}
  })
});
