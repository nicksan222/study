/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Finds selected and attachment-only reply dependencies on exact historical          │
 * │ Documents.                                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Records consumed capture intents before scrubbing private snapshots.                   │
 * │ - Discards unfinished replies while preserving independently published messages.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Conversations owns its snapshots; Materials supplies exact accepted version membership.  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { runSelectionContextSchema } from '@study/contracts/conversations/context';
import { replySnapshotSchema } from '@study/contracts/conversations/schemas';
import {
  historyOperationKeySchema,
  historyVersionIdsSchema
} from '@study/contracts/materials/history';
import { eq, inArray } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import { impactToken } from '#server/platform/definitions/impact-token';

import { makeMaterialRetirement } from './material-retirement.ts';

const contextCodec = Schema.fromJsonString(Schema.toCodecJson(runSelectionContextSchema));

const replyCodec = Schema.fromJsonString(Schema.toCodecJson(replySnapshotSchema));

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

    const retirement = makeMaterialRetirement(resources);

    function rows(ids: typeof historyVersionIdsSchema.Type) {
      const documentIds = [
        ...db.orm
          .select({ documentId: s.material_source_snapshots.document_id })
          .from(s.material_source_snapshots)
          .where(inArray(s.material_source_snapshots.version_id, [...ids]))
          .all()
          .flatMap((pin) => (pin.documentId === null ? [] : [pin.documentId])),
        ...db.orm
          .select({ documentId: s.material_document_versions.document_id })
          .from(s.material_document_versions)
          .where(inArray(s.material_document_versions.version_id, [...ids]))
          .all()
          .map((pin) => pin.documentId)
      ];

      const documents = db.orm
        .select({ sourceId: s.documents.source_id, id: s.documents.id })
        .from(s.documents)
        .where(inArray(s.documents.id, documentIds))
        .all();

      const attachmentRoots = new Set(
        documents.map((document) => `${document.sourceId}/${document.id}`)
      );

      const replies = db.orm
        .select()
        .from(s.conversation_reply_requests)
        .all()
        .filter((row) => {
          const snapshot = Schema.decodeUnknownSync(replyCodec)(row.snapshot);

          return (
            snapshot.context?.inputs.some((input) => ids.includes(input.versionId)) ||
            snapshot.messages
              .flatMap((message) => message.attachments)
              .some((attachment) =>
                attachmentRoots.has(`${attachment.sourceId}/${attachment.documentId}`)
              )
          );
        });

      const replyIds = new Set(replies.map((reply) => reply.request_id));

      const contexts = db.orm
        .select()
        .from(s.session_run_contexts)
        .all()
        .filter(
          (row) =>
            replyIds.has(row.request_id) ||
            Schema.decodeUnknownSync(contextCodec)(row.snapshot).inputs.some((input) =>
              ids.includes(input.versionId)
            )
        );

      const citations = db.orm
        .select({
          messageVersionId: s.citations.version_id,
          marker: s.citations.marker,
          materialVersionId: s.citations.material_version_id
        })
        .from(s.citations)
        .where(inArray(s.citations.material_version_id, [...ids]))
        .all();

      const sessions = retirement.selectedSessions(ids);

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
              token: impactToken(value),
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

            retirement.removeSelections(ids);

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
              retirement.scrubRequest(r.request_id);
            }
          }
        })
      }
    };
  }
});
