/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Removes private captures affected by Material deletion without deleting session    │
 * │ messages.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps exact deletion behavior behind the owning feature boundary.                      │
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
import { materialIdSchema, sourceIdSchema, sessionIdSchema } from '@study/contracts/ids';
import { eq } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';

import { makeDiscardPending } from './pending.ts';

const contextCodec = Schema.fromJsonString(Schema.toCodecJson(runSelectionContextSchema));
const replyCodec = Schema.fromJsonString(Schema.toCodecJson(replySnapshotSchema));
const selectionCodec = Schema.fromJsonString(Schema.toCodecJson(selectionTargetsSchema));
export const ConversationMaterialDeletionStore = defineStore({
  name: 'study/ConversationMaterialDeletionStore',
  entity: { singular: 'conversationMaterialDeletion', plural: 'conversationMaterialDeletions' },
  make: (resources) => {
    const { db } = resources;
    const discardPending = makeDiscardPending(resources);
    return {
      queries: {},
      mutations: {
        prepare: storeMutation({
          input: Schema.Struct({
            deletionId: materialIdSchema,
            materialIds: Schema.Array(materialIdSchema),
            sourceIds: Schema.Array(sourceIdSchema)
          }),
          output: Schema.Array(Schema.String),
          run: ({ materialIds, sourceIds }) => {
            const versionIds = db.orm
              .select()
              .from(s.material_versions)
              .all()
              .filter((v) => materialIds.includes(v.material_id))
              .map((v) => String(v.id));
            const matches = (snapshot: unknown) =>
              captured(snapshot, materialIds.map(String), sourceIds.map(String));
            const contexts = db.orm
              .select()
              .from(s.session_run_contexts)
              .all()
              .filter((r) => matches(Schema.decodeUnknownSync(contextCodec)(r.snapshot)));
            const replies = db.orm
              .select()
              .from(s.conversation_reply_requests)
              .all()
              .filter((r) => matches(Schema.decodeUnknownSync(replyCodec)(r.snapshot)));
            const ids = [...new Set([...contexts, ...replies].map((r) => r.request_id))];
            for (const session of db.orm.select().from(s.sessions).all()) {
              const previous = Schema.decodeUnknownSync(selectionCodec)(session.selection);
              const selected = previous.filter((t) => !versionIds.includes(String(t.versionId)));
              if (selected.length !== previous.length)
                db.orm
                  .update(s.sessions)
                  .set({
                    selection: Schema.encodeSync(selectionCodec)(selected),
                    selection_revision: session.selection_revision + 1n
                  })
                  .where(eq(s.sessions.id, session.id))
                  .run();
            }
            return ids;
          }
        }),
        scrub: storeMutation({
          input: materialIdSchema,
          output: Schema.Void,
          run: (id) => {
            const requests = db.orm
              .select()
              .from(s.material_deletion_requests)
              .where(eq(s.material_deletion_requests.deletion_id, id))
              .all()
              .filter((r) => r.kind === 'context');
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

function captured(
  value: unknown,
  materials: readonly string[],
  sources: readonly string[]
): boolean {
  if (Array.isArray(value)) return value.some((v) => captured(v, materials, sources));
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([k, v]) =>
      (k === 'materialId' && materials.includes(String(v))) ||
      (k === 'sourceId' && sources.includes(String(v))) ||
      captured(v, materials, sources)
  );
}
export const ConversationMaterialImpactStore = defineStore({
  name: 'study/ConversationMaterialImpactStore',
  entity: { singular: 'conversationMaterialImpact', plural: 'conversationMaterialImpacts' },
  make: ({ db }) => ({
    queries: {
      conversationMaterialImpact: storeQuery({
        role: 'required',
        input: Schema.Struct({
          materialIds: Schema.Array(materialIdSchema),
          sourceIds: Schema.Array(sourceIdSchema)
        }),
        output: Schema.Struct({
          token: Schema.String,
          requestIds: Schema.Array(Schema.String),
          sessionIds: Schema.Array(sessionIdSchema),
          messageCitationCount: Schema.Int
        }),
        run: ({ materialIds, sourceIds }) => {
          const versionIds = db.orm
            .select()
            .from(s.material_versions)
            .all()
            .filter((v) => materialIds.includes(v.material_id))
            .map((v) => String(v.id));
          const matches = (snapshot: unknown) =>
            captured(snapshot, materialIds.map(String), sourceIds.map(String));
          const contexts = db.orm
            .select()
            .from(s.session_run_contexts)
            .all()
            .filter((r) => matches(Schema.decodeUnknownSync(contextCodec)(r.snapshot)));
          const replies = db.orm
            .select()
            .from(s.conversation_reply_requests)
            .all()
            .filter((r) => matches(Schema.decodeUnknownSync(replyCodec)(r.snapshot)));
          const citations = db.orm
            .select()
            .from(s.citations)
            .all()
            .filter(
              (c) =>
                (c.source_id !== null && sourceIds.includes(c.source_id)) ||
                (c.material_version_id !== null &&
                  db.orm
                    .select()
                    .from(s.material_versions)
                    .where(eq(s.material_versions.id, c.material_version_id))
                    .all()
                    .some((v) => materialIds.includes(v.material_id)))
            );
          const sessions = db.orm
            .select()
            .from(s.sessions)
            .all()
            .filter((r) =>
              Schema.decodeUnknownSync(selectionCodec)(r.selection).some((t) =>
                versionIds.includes(String(t.versionId))
              )
            );
          return {
            token: createHash('sha256')
              .update(
                JSON.stringify({ contexts, replies, citations, sessions }, (_, v) =>
                  typeof v === 'bigint' ? String(v) : v
                )
              )
              .digest('hex'),
            requestIds: [...new Set([...contexts, ...replies].map((r) => r.request_id))],
            sessionIds: [
              ...new Set(
                [...contexts, ...replies, ...sessions].map((r) =>
                  'session_id' in r ? r.session_id : r.id
                )
              )
            ],
            messageCitationCount: citations.length
          };
        }
      })
    },
    mutations: {}
  })
});
