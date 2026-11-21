/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines note persistence stores and their typed queries and mutations.             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports typed store definitions consumed by the note service.                          │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the notes service applies policy and            │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { noteSummariesSchema } from '@study/contracts';
import { notes, sql } from '@study/db';
import { defineStore, storeQuery } from '@study/server';
import { Schema } from 'effect';

/** Aggregate the canonical memberships and workflow receipts in a single database read. */
export const NoteSummaryStore = defineStore({
  name: 'study/NoteSummaryStore',
  entity: { singular: 'noteSummary', plural: 'noteSummaries' },
  make: ({ db }) => ({
    queries: {
      noteSummary: storeQuery({
        role: 'required',
        input: Schema.Struct({}),
        output: noteSummariesSchema,
        run: () => ({
          items: db.orm
            .select({
              id: notes.id,
              generatedPageCount: sql<bigint>`(
            SELECT count(*) FROM note_pages sd
            JOIN pages d ON d.id = sd.page_id
            WHERE sd.note_id = ${notes}.${notes.id} AND d.archived_at IS NULL AND sd.archived_at IS NULL
            AND NOT EXISTS(SELECT 1 FROM page_deletions deleted WHERE deleted.page_id=d.id)
            AND EXISTS (SELECT 1 FROM page_versions v WHERE v.page_id = d.id
              AND v.status = 'published' AND v.creator = 'agent'
              AND NOT EXISTS(SELECT 1 FROM page_retirements r WHERE r.version_id=v.id))
          )`,
              activity: sql<'idle' | 'generating' | 'processing' | 'answering'>`CASE
            WHEN EXISTS (
              SELECT 1 FROM page_transform_requests gr
              JOIN workflow_executions w ON json_extract(w.payload, '$.event.correlationId') = gr.id
              WHERE gr.note_id = ${notes}.${notes.id} AND gr.cancelled = 0 AND gr.result_version_id IS NULL
                AND w.status IN ('running', 'suspended')
            ) THEN 'generating'
            WHEN EXISTS (
              SELECT 1 FROM note_reply_requests rr
              JOIN workflow_executions w ON json_extract(w.payload, '$.event.correlationId') = rr.request_id
              WHERE rr.note_id = ${notes}.${notes.id} AND w.status IN ('running', 'suspended')
            ) THEN 'answering'
            WHEN EXISTS (
              SELECT 1 FROM messages msg JOIN message_parts part ON part.message_id = msg.id
              JOIN source_processing sp ON sp.source_id = part.source_id
              JOIN workflow_executions w ON json_extract(w.payload, '$.event.correlationId') = sp.request_id
              WHERE msg.note_id = ${notes}.${notes.id} AND w.status IN ('running', 'suspended')
                AND (sp.published_request_id IS NULL OR sp.published_request_id != sp.request_id)
            ) THEN 'processing' ELSE 'idle' END`
            })
            .from(notes)
            .all()
            .map((row) => ({
              ...row,
              running: row.activity !== 'idle'
            }))
        })
      })
    },
    mutations: {}
  })
});
