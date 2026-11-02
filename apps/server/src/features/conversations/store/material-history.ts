/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Material history pruning owns exact scope, barriers and content retirement; native        │
 * │ Workflow owns execution.                                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps exact history behavior behind the owning feature boundary.                      │
 * │ - Preserves durable identities without retaining private captured content.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native Workflow owns execution; public participants coordinate synchronous feature       │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createHash } from 'node:crypto';

import {
  runSelectionContextSchema,
  selectionTargetsSchema
} from '@study/contracts/conversations/context';
import { replySnapshotSchema } from '@study/contracts/conversations/schemas';
import {
  historyOperationKeySchema,
  historyVersionIdsSchema
} from '@study/contracts/materials/history';
import { eq, inArray } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';

import { makeDiscardPending } from './pending.ts';

const contextCodec = Schema.fromJsonString(Schema.toCodecJson(runSelectionContextSchema));
const replyCodec = Schema.fromJsonString(Schema.toCodecJson(replySnapshotSchema));
const selectionCodec = Schema.fromJsonString(Schema.toCodecJson(selectionTargetsSchema));
const impactSchema = Schema.Struct({
  token: Schema.String,
  requestIds: Schema.Array(Schema.String),
  messageCitationCount: Schema.Int
});

export const ConversationMaterialHistoryStore = defineStore({
  name: 'study/ConversationMaterialHistoryStore',
  entity: { singular: 'conversationMaterialHistory', plural: 'conversationMaterialHistories' },
  make: (resources) => {
    const { db } = resources;
    const discardPending = makeDiscardPending(resources);
    function rows(ids: typeof historyVersionIdsSchema.Type) {
      const contexts = db.orm
        .select()
        .from(s.session_run_contexts)
        .all()
        .filter((r) =>
          Schema.decodeUnknownSync(contextCodec)(r.snapshot).inputs.some((i) =>
            ids.includes(i.versionId)
          )
        );
      const replies = db.orm
        .select()
        .from(s.conversation_reply_requests)
        .all()
        .filter((r) =>
          Schema.decodeUnknownSync(replyCodec)(r.snapshot).context?.inputs.some((i) =>
            ids.includes(i.versionId)
          )
        );
      const citations = db.orm
        .select()
        .from(s.citations)
        .where(inArray(s.citations.material_version_id, [...ids]))
        .all();
      const sessions = db.orm
        .select()
        .from(s.sessions)
        .all()
        .filter((r) =>
          Schema.decodeUnknownSync(selectionCodec)(r.selection).some((t) =>
            ids.includes(t.versionId)
          )
        );
      return { contexts, replies, citations, sessions };
    }
    return {
      queries: {
        conversationMaterialHistory: storeQuery({
          role: 'required',
          input: historyVersionIdsSchema,
          output: impactSchema,
          run: (ids) => {
            const value = rows(ids);
            return {
              token: createHash('sha256')
                .update(JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? String(v) : v)))
                .digest('hex'),
              requestIds: [
                ...new Set([...value.contexts, ...value.replies].map((r) => r.request_id))
              ],
              messageCitationCount: value.citations.length
            };
          }
        })
      },
      mutations: {
        prepare: storeMutation({
          input: historyVersionIdsSchema,
          output: Schema.Array(Schema.String),
          run: (ids) => {
            const value = rows(ids);
            for (const context of value.contexts)
              db.orm
                .insert(s.conversation_history_intents)
                .values({
                  session_id: context.session_id,
                  intent_key: context.intent_key,
                  request_id: context.request_id
                })
                .onConflictDoNothing()
                .run();
            for (const session of value.sessions)
              db.orm
                .update(s.sessions)
                .set({
                  selection: Schema.encodeSync(selectionCodec)(
                    Schema.decodeUnknownSync(selectionCodec)(session.selection).filter(
                      (t) => !ids.includes(t.versionId)
                    )
                  ),
                  selection_revision: session.selection_revision + 1n
                })
                .where(eq(s.sessions.id, session.id))
                .run();
            return [...new Set([...value.contexts, ...value.replies].map((r) => r.request_id))];
          }
        }),
        scrub: storeMutation({
          input: historyOperationKeySchema,
          output: Schema.Void,
          run: ({ operationId }) => {
            const requests = db.orm
              .select()
              .from(s.material_history_requests)
              .where(eq(s.material_history_requests.operation_id, operationId))
              .all();
            for (const r of requests) {
              const reply = db.orm
                .select({ message: s.messages, version: s.message_versions })
                .from(s.conversation_reply_requests)
                .innerJoin(
                  s.message_versions,
                  eq(s.message_versions.id, s.conversation_reply_requests.version_id)
                )
                .innerJoin(s.messages, eq(s.messages.id, s.message_versions.message_id))
                .where(eq(s.conversation_reply_requests.request_id, r.request_id))
                .get();
              if (reply && reply.version.status !== 'complete')
                discardPending(reply.message, reply.version);
              db.orm
                .delete(s.conversation_reply_requests)
                .where(eq(s.conversation_reply_requests.request_id, r.request_id))
                .run();
              db.orm
                .delete(s.session_run_contexts)
                .where(eq(s.session_run_contexts.request_id, r.request_id))
                .run();
            }
          }
        })
      }
    };
  }
});
