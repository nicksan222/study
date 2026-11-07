/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Copies independent notebook histories and records atomic manual merge receipts.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves copied content and original notebook ownership.                              │
 * │ - Verifies or enforces atomic merge identity and persistence.                            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Conversation stores retain private persistence behind typed transaction participants.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { selectionTargetsSchema } from '@study/contracts/conversations/context';
import { mergeSessionsInputSchema } from '@study/contracts/conversations/rpc';
import { ConversationMode } from '@study/contracts/conversations/schemas';
import { copySessionContentSchema } from '@study/contracts/conversations/sessions';
import { StudyError } from '@study/contracts/errors';
import {
  materialIdSchema,
  studyDocumentIdSchema,
  sourceIdSchema,
  sessionIdSchema
} from '@study/contracts/ids';
import { and, asc, eq, inArray, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

import { copyMessagesInputSchema, makeMessageCopy } from './message-copy.ts';

export const SessionMergeStore = defineStore({
  name: 'study/SessionMergeStore',
  entity: { singular: 'sessionMerge', plural: 'sessionMerges' },
  make: (resources) => ({
    queries: {
      sessionMerge: storeQuery({
        role: 'required',
        input: copySessionContentSchema.fields.sessionIds,
        output: Schema.Struct({
          documents: Schema.Array(
            Schema.Struct({ id: studyDocumentIdSchema, archivedAt: Schema.NullOr(Schema.BigInt) })
          ),
          sources: Schema.Array(
            Schema.Struct({ id: sourceIdSchema, archivedAt: Schema.NullOr(Schema.BigInt) })
          ),
          materials: Schema.Array(materialIdSchema)
        }),
        run: (ids) => ({
          documents: resources.db.orm
            .select({
              id: s.session_documents.document_id,
              archivedAt: s.session_documents.archived_at
            })
            .from(s.session_documents)
            .where(inArray(s.session_documents.session_id, ids))
            .orderBy(asc(s.session_documents.session_id), asc(s.session_documents.position))
            .all(),
          sources: resources.db.orm
            .select({ id: s.session_sources.source_id, archivedAt: s.session_sources.archived_at })
            .from(s.session_sources)
            .where(inArray(s.session_sources.session_id, ids))
            .orderBy(asc(s.session_sources.session_id), asc(s.session_sources.position))
            .all(),
          materials: resources.db.orm
            .select({ id: s.session_materials.material_id })
            .from(s.session_materials)
            .where(inArray(s.session_materials.session_id, ids))
            .orderBy(asc(s.session_materials.session_id), asc(s.session_materials.position))
            .all()
            .map((row) => row.id)
        })
      })
    },
    mutations: {
      copyMessages: storeMutation({
        input: copyMessagesInputSchema,
        output: Schema.Void,
        run: makeMessageCopy(resources)
      }),
      merge: storeMutation({
        input: mergeSessionsInputSchema,
        output: Schema.Struct({ id: sessionIdSchema, created: Schema.Boolean }),
        run: ({ sessionIds, intentKey }) => {
          const { db, clock } = resources;
          const ids = distinctSessionIds(sessionIds);

          const intent = JSON.stringify(ids.map(String));
          const receipt = db.orm
            .select()
            .from(s.session_merges)
            .where(eq(s.session_merges.intent_key, intentKey))
            .get();

          if (receipt) {
            if (receipt.session_ids !== intent)
              throw new StudyError('invalid_input', 'Merge intent changed');

            return { id: receipt.session_id, created: false };
          }

          const originals = db.orm
            .select()
            .from(s.sessions)
            .where(inArray(s.sessions.id, ids))
            .all();

          if (originals.length !== ids.length)
            throw new StudyError('not_found', 'Session not found');

          if (
            originals.some(
              (row) => row.mode !== ConversationMode.Notebook || row.archived_at !== null
            )
          )
            throw new StudyError('invalid_input', 'Only active notebook sessions can be merged');

          if (
            db.orm
              .select()
              .from(s.session_deletions)
              .where(inArray(s.session_deletions.session_id, ids))
              .get()
          )
            throw new StudyError('invalid_input', 'Session deletion is in progress');

          if (
            db.orm
              .select()
              .from(s.study_document_transform_requests)
              .where(
                and(
                  inArray(s.study_document_transform_requests.session_id, ids),
                  eq(s.study_document_transform_requests.cancelled, false),
                  sql`${s.study_document_transform_requests.result_version_id} IS NULL`
                )
              )
              .get()
          )
            throw new StudyError(
              'invalid_input',
              'Finish or cancel document generation before merging'
            );

          const decode = Schema.decodeUnknownSync(
            Schema.fromJsonString(Schema.toCodecJson(selectionTargetsSchema))
          );
          const selections = [
            ...new Map(
              originals
                .flatMap((row) => decode(row.selection))
                .map((target) => [
                  JSON.stringify(target, (_key, value) =>
                    typeof value === 'bigint' ? String(value) : value
                  ),
                  target
                ])
            ).values()
          ];

          if (selections.length > 20)
            throw new StudyError('invalid_input', 'Too many selected inputs to merge');

          const selection = Schema.encodeSync(
            Schema.fromJsonString(Schema.toCodecJson(selectionTargetsSchema))
          )(selections);
          const now = unixSeconds(clock);
          const created = db.orm
            .insert(s.sessions)
            .values({
              title: [...originals.map((row) => row.title).join(' · ')].slice(0, 200).join(''),
              selection,
              title_source: 'provisional',
              created_at: now,
              updated_at: now
            })
            .returning()
            .get();

          for (const link of db.orm
            .select()
            .from(s.project_sessions)
            .where(inArray(s.project_sessions.session_id, ids))
            .all())
            db.orm
              .insert(s.project_sessions)
              .values({ ...link, session_id: created.id })
              .onConflictDoNothing()
              .run();

          db.orm
            .update(s.sessions)
            .set({ archived_at: now })
            .where(inArray(s.sessions.id, ids))
            .run();
          db.orm
            .insert(s.session_merges)
            .values({ intent_key: intentKey, session_ids: intent, session_id: created.id })
            .run();

          return { id: created.id, created: true };
        }
      })
    }
  })
});

function distinctSessionIds(sessionIds: (typeof mergeSessionsInputSchema.Type)['sessionIds']) {
  const ids = [...new Set(sessionIds)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  if (ids.length < 2 || ids.length !== sessionIds.length)
    throw new StudyError('invalid_input', 'Select distinct sessions to merge');

  return ids;
}
