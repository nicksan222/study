/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Validates retained conversation payloads and session cleanup readiness for managed │
 * │ backup snapshots.                                                                        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Decodes selections, captures, replies and citation anchors without resuming work.      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Conversations owns these read checks; runtime invokes only its public transaction        │
 * │ participant.                                                                             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import {
  sessionContextIntentSchema,
  runSelectionContextSchema,
  selectionTargetsSchema
} from '@study/contracts/conversations/context';
import { replySnapshotSchema } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { anchorSchema } from '@study/contracts/sources/schemas';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeQuery, storeMutation } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeDiscardPending } from './pending.ts';

function makeCaptureValidation({ db }: StoreResources) {
  const context = Schema.decodeUnknownSync(
    Schema.fromJsonString(Schema.toCodecJson(runSelectionContextSchema))
  );

  const intent = Schema.decodeUnknownSync(
    Schema.fromJsonString(Schema.toCodecJson(sessionContextIntentSchema))
  );

  return (row: typeof s.session_run_contexts.$inferSelect, requireRetired: boolean) => {
    const captured = context(row.snapshot);

    const requested = intent(row.intent);

    if (
      captured.requestId !== row.request_id ||
      captured.sessionId !== row.session_id ||
      captured.intentKey !== row.intent_key ||
      captured.askDigest !== requested.askDigest ||
      requested.sessionId !== row.session_id ||
      requested.intentKey !== row.intent_key
    )
      throw new StudyError('invalid_input', 'Backup capture identity is invalid');

    if (
      requireRetired &&
      !db.orm.get(
        sql`SELECT 1 FROM workflow_retired_correlations WHERE correlation_id=${row.request_id} AND event_type='ConversationGenerationRequested'`
      )
    )
      throw new StudyError('invalid_input', 'Backup contains actionable conversation capture');
  };
}

function makeReplyValidation({ db }: StoreResources) {
  return (row: typeof s.conversation_reply_requests.$inferSelect) => {
    const captured = Schema.decodeUnknownSync(
      Schema.fromJsonString(Schema.toCodecJson(replySnapshotSchema))
    )(row.snapshot);
    const version = db.orm
      .select()
      .from(s.message_versions)
      .where(eq(s.message_versions.id, row.version_id))
      .get();

    if (
      captured.requestId !== row.request_id ||
      captured.sessionId !== row.session_id ||
      captured.versionId !== row.version_id ||
      !version ||
      version.message_id !== captured.messageId ||
      (version.generation_request_id !== null && version.generation_request_id !== row.request_id)
    )
      throw new StudyError('invalid_input', 'Backup reply provenance is invalid');
  };
}

export const ConversationBackupStore = defineStore({
  name: 'study/ConversationBackupStore',
  entity: { singular: 'backupConversation', plural: 'backupConversations' },
  make: (resources) => {
    const { db } = resources;

    const discardPending = makeDiscardPending(resources);

    const validateCapture = makeCaptureValidation(resources);
    const validateReply = makeReplyValidation(resources);

    return {
      queries: {
        backupConversation: storeQuery({
          role: 'required',
          input: Schema.Boolean,
          output: Schema.Boolean,
          run: (requireRetired) => {
            if (
              db.orm.get(sql`SELECT 1 FROM session_deletions WHERE status != 'completed' LIMIT 1`)
            )
              throw new StudyError('invalid_input', 'Backup requires completed session cleanup');

            const selection = Schema.decodeUnknownSync(
              Schema.fromJsonString(Schema.toCodecJson(selectionTargetsSchema))
            );

            for (const row of db.orm.select().from(s.sessions).all()) selection(row.selection);

            for (const row of db.orm.select().from(s.session_run_contexts).all()) {
              validateCapture(row, requireRetired);
            }

            for (const row of db.orm.select().from(s.conversation_reply_requests).all()) {
              validateReply(row);
            }

            for (const row of db.orm.select().from(s.citations).all())
              Schema.decodeUnknownSync(anchorSchema)(JSON.parse(row.anchor));

            return true;
          }
        })
      },
      mutations: {
        prepare: storeMutation({
          input: Schema.Void,
          output: Schema.Array(Schema.String),
          run: () => {
            const pending = db.orm
              .select({ message: s.messages, version: s.message_versions })
              .from(s.message_versions)
              .innerJoin(s.messages, eq(s.messages.id, s.message_versions.message_id))
              .where(sql`${s.message_versions.status} != 'complete'`)
              .all();

            for (const row of pending) discardPending(row.message, row.version);

            return db.orm
              .select({ id: s.session_run_contexts.request_id })
              .from(s.session_run_contexts)
              .all()
              .map((row) => row.id);
          }
        })
      }
    };
  }
});
