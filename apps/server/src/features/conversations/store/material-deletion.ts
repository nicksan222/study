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

import { runSelectionContextSchema } from '@study/contracts/conversations/context';
import { replySnapshotSchema } from '@study/contracts/conversations/schemas';
import { materialIdSchema, sourceIdSchema, sessionIdSchema } from '@study/contracts/ids';
import { eq } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeMaterialRetirement } from './material-retirement.ts';

const contextCodec = Schema.fromJsonString(Schema.toCodecJson(runSelectionContextSchema));

const replyCodec = Schema.fromJsonString(Schema.toCodecJson(replySnapshotSchema));

function makeCapturedRows({ db }: StoreResources) {
  return (
    materialIds: readonly (typeof materialIdSchema.Type)[],
    sourceIds: readonly (typeof sourceIdSchema.Type)[]
  ) => {
    const versionIds = db.orm
      .select()
      .from(s.material_versions)
      .all()
      .filter((v) => materialIds.includes(v.material_id))
      .map((v) => v.id);
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

    return { versionIds, contexts, replies };
  };
}

export const ConversationMaterialDeletionStore = defineStore({
  name: 'study/ConversationMaterialDeletionStore',
  entity: { singular: 'conversationMaterialDeletion', plural: 'conversationMaterialDeletions' },
  make: (resources) => {
    const { db } = resources;

    const retirement = makeMaterialRetirement(resources);
    const capturedRows = makeCapturedRows(resources);

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
            const { versionIds, contexts, replies } = capturedRows(materialIds, sourceIds);

            const ids = [...new Set([...contexts, ...replies].map((r) => r.request_id))];

            retirement.removeSelections(versionIds);

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
              .all();

            for (const r of requests) {
              retirement.scrubRequest(r.request_id);
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
  make: (resources) => {
    const { db } = resources;
    const capturedRows = makeCapturedRows(resources);
    const retirement = makeMaterialRetirement(resources);

    return {
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
            const { versionIds, contexts, replies } = capturedRows(materialIds, sourceIds);

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

            const sessions = retirement.selectedSessions(versionIds);

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
    };
  }
});
