/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Discovers bounded session generation identities from durable feature owners.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reads exact capture, proposal and retirement associations without retaining payloads.  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature policy uses public participants; native Workflow owns execution.                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import {
  sessionGenerationPageInputSchema,
  sessionGenerationSchema
} from '@study/contracts/conversations/rpc';
import type { MaterialVersionId } from '@study/contracts/ids';
import { sql } from '@study/db';
import { Schema } from 'effect';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';

/** Content-free discovery uses canonical context, proposal and retirement owners. */
export const SessionGenerationsStore = defineStore({
  name: 'study/SessionGenerationsStore',
  entity: { singular: 'sessionGeneration', plural: 'sessionGenerations' },
  make: ({ db }) => ({
    queries: {
      sessionGenerations: storeQuery({
        role: 'collection',
        input: sessionGenerationPageInputSchema,
        output: Schema.Array(sessionGenerationSchema),
        run: (input) =>
          db.orm
            .all<{
              requestId: string;
              contextRequestId: string | null;
              state: 'available' | 'retired' | 'unavailable';
              cancelled: number;
              resultVersionId: bigint | null;
              proposedVersionId: bigint | null;
              baseVersionId: bigint | null;
            }>(sql`
          SELECT g.id AS requestId,
            COALESCE(c.request_id, ci.request_id, ci.deletion_request_id) AS contextRequestId,
            CASE WHEN sr.request_id IS NOT NULL OR hr.request_id IS NOT NULL OR dr.request_id IS NOT NULL
              OR ci.session_id IS NOT NULL THEN 'retired'
              WHEN c.request_id IS NULL THEN 'unavailable' ELSE 'available' END AS state,
            g.cancelled AS cancelled,
            CASE WHEN sr.request_id IS NULL AND hr.request_id IS NULL AND dr.request_id IS NULL
              AND ci.session_id IS NULL THEN g.result_version_id ELSE NULL END AS resultVersionId,
            CASE WHEN sr.request_id IS NULL AND hr.request_id IS NULL AND dr.request_id IS NULL
              AND ci.session_id IS NULL THEN p.proposed_version_id ELSE NULL END AS proposedVersionId,
            CASE WHEN sr.request_id IS NULL AND hr.request_id IS NULL AND dr.request_id IS NULL
              AND ci.session_id IS NULL THEN p.base_version_id ELSE NULL END AS baseVersionId
          FROM material_generation_requests g
          LEFT JOIN session_run_contexts c
            ON c.request_id = json_extract(g.payload, '$.documentTransform.contextRequestId')
            AND g.id = 'document/' || c.request_id AND c.session_id = ${input.sessionId}
          LEFT JOIN document_proposals p ON p.request_id = g.id AND p.session_id = ${input.sessionId}
          LEFT JOIN session_generation_retirements sr ON sr.request_id = g.id AND sr.session_id = ${input.sessionId}
          LEFT JOIN material_history_requests hr ON hr.request_id = g.id
          LEFT JOIN material_deletion_requests dr ON dr.request_id = g.id
          LEFT JOIN conversation_history_intents ci
            ON g.id = 'document/' || COALESCE(ci.request_id, ci.deletion_request_id) AND ci.session_id = ${input.sessionId}
          WHERE (c.session_id = ${input.sessionId} OR p.session_id = ${input.sessionId}
            OR sr.session_id = ${input.sessionId} OR ci.session_id = ${input.sessionId})
            AND (${input.before ?? null} IS NULL OR g.id < ${input.before ?? null})
          ORDER BY g.id DESC LIMIT ${input.limit}
        `)
            .map((row) => ({
              ...row,
              cancelled: Boolean(row.cancelled),
              resultVersionId:
                row.resultVersionId === null
                  ? null
                  : (BigInt(row.resultVersionId) as MaterialVersionId),
              proposedVersionId:
                row.proposedVersionId === null
                  ? null
                  : (BigInt(row.proposedVersionId) as MaterialVersionId),
              baseVersionId:
                row.baseVersionId === null ? null : (BigInt(row.baseVersionId) as MaterialVersionId)
            }))
      })
    },
    mutations: {}
  })
});
