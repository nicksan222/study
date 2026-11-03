/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines conversation persistence stores and their typed queries and mutations.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports typed store definitions consumed by the conversation service.                  │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the conversations service applies policy and    │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { setSessionSettledInputSchema } from '@study/contracts/conversations/rpc';
import { sessionSummariesSchema } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { eq, sql } from '@study/db';
import { sessions, session_deletions, session_sidebar_preferences } from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeQuery, storeMutation } from '#server/platform/definitions/define-store';

/** Aggregate the canonical memberships and workflow receipts in a single database read. */
export const SessionSummaryStore = defineStore({
  name: 'study/SessionSummaryStore',
  entity: { singular: 'sessionSummary', plural: 'sessionSummaries' },
  make: ({ db }) => ({
    queries: {
      sessionSummary: storeQuery({
        role: 'required',
        input: Schema.Struct({}),
        output: sessionSummariesSchema,
        run: () => ({
          items: db.orm
            .select({
              id: sessions.id,
              settledOverrideValue: sql<
                bigint | null
              >`(SELECT p.settled FROM session_sidebar_preferences p WHERE p.session_id = ${sessions}.${sessions.id})`,
              generatedDocumentCount: sql<bigint>`(
            SELECT count(*) FROM session_materials sm
            JOIN materials mat ON mat.id = sm.material_id
            WHERE sm.session_id = ${sessions}.${sessions.id} AND mat.kind = 'document' AND mat.archived_at IS NULL
            AND EXISTS (SELECT 1 FROM material_versions mv WHERE mv.material_id = mat.id
              AND mv.status = 'published' AND mv.creator = 'agent')
          )`,
              activity: sql<'idle' | 'generating' | 'processing' | 'answering'>`CASE
            WHEN EXISTS (
              SELECT 1 FROM material_generation_requests gr
              JOIN session_run_contexts ctx ON ctx.request_id = json_extract(gr.payload, '$.documentTransform.contextRequestId')
              JOIN workflow_executions w ON json_extract(w.payload, '$.event.correlationId') = gr.id
              WHERE ctx.session_id = ${sessions}.${sessions.id} AND gr.cancelled = 0 AND gr.result_version_id IS NULL
                AND w.status IN ('running', 'suspended')
            ) THEN 'generating'
            WHEN EXISTS (
              SELECT 1 FROM conversation_reply_requests rr
              JOIN workflow_executions w ON json_extract(w.payload, '$.event.correlationId') = rr.request_id
              WHERE rr.session_id = ${sessions}.${sessions.id} AND w.status IN ('running', 'suspended')
            ) THEN 'answering'
            WHEN EXISTS (
              SELECT 1 FROM messages msg JOIN message_parts part ON part.message_id = msg.id
              JOIN source_processing sp ON sp.source_id = part.source_id
              JOIN workflow_executions w ON json_extract(w.payload, '$.event.correlationId') = sp.request_id
              WHERE msg.session_id = ${sessions}.${sessions.id} AND w.status IN ('running', 'suspended')
                AND (sp.published_request_id IS NULL OR sp.published_request_id != sp.request_id)
            ) THEN 'processing' ELSE 'idle' END`
            })
            .from(sessions)
            .all()
            .map(({ settledOverrideValue, ...row }) => ({
              ...row,
              settledOverride: settledOverrideValue === null ? null : settledOverrideValue === 1n,
              running: row.activity !== 'idle'
            }))
        })
      })
    },
    mutations: {
      setSessionSettled: storeMutation({
        input: setSessionSettledInputSchema,
        output: Schema.Struct({}),
        run: ({ id, settled }) => {
          if (!db.orm.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, id)).get())
            throw new StudyError('not_found', 'Session not found');

          if (
            db.orm
              .select({ id: session_deletions.session_id })
              .from(session_deletions)
              .where(eq(session_deletions.session_id, id))
              .get()
          )
            throw new StudyError('invalid_input', 'Session deletion is in progress');

          db.orm
            .insert(session_sidebar_preferences)
            .values({ session_id: id, settled })
            .onConflictDoUpdate({
              target: session_sidebar_preferences.session_id,
              set: { settled }
            })
            .run();

          return {};
        }
      })
    }
  })
});
