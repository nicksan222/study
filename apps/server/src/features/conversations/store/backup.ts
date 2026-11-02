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
  captureSessionContextSchema,
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

import { makeDiscardPending } from './pending.ts';

export const ConversationBackupStore = defineStore({
  name: 'study/ConversationBackupStore',
  entity: { singular: 'backupConversation', plural: 'backupConversations' },
  make: (resources) => {
    const { db } = resources;
    const discardPending = makeDiscardPending(resources);

    return {
      queries: {
        backupConversation: storeQuery({
          role: 'required',
          input: Schema.Void,
          output: Schema.Boolean,
          run: () => {
            if (
              db.orm.get(sql`SELECT 1 FROM session_deletions WHERE status != 'completed' LIMIT 1`)
            )
              throw new StudyError('invalid_input', 'Backup requires completed session cleanup');

            const context = Schema.decodeUnknownSync(
              Schema.fromJsonString(Schema.toCodecJson(runSelectionContextSchema))
            );
            const intent = Schema.decodeUnknownSync(
              Schema.fromJsonString(Schema.toCodecJson(captureSessionContextSchema))
            );
            const selection = Schema.decodeUnknownSync(
              Schema.fromJsonString(Schema.toCodecJson(selectionTargetsSchema))
            );

            for (const row of db.orm.select().from(s.sessions).all()) selection(row.selection);

            for (const row of db.orm.select().from(s.session_run_contexts).all()) {
              context(row.snapshot);
              intent(row.intent);
            }

            const reply = Schema.decodeUnknownSync(
              Schema.fromJsonString(Schema.toCodecJson(replySnapshotSchema))
            );

            for (const row of db.orm.select().from(s.conversation_reply_requests).all())
              reply(row.snapshot);

            for (const row of db.orm.select().from(s.citations).all())
              Schema.decodeUnknownSync(anchorSchema)(JSON.parse(row.anchor));

            return true;
          }
        })
      },
      mutations: {
        prepare: storeMutation({
          input: Schema.Void,
          output: Schema.Void,
          run: () => {
            const pending = db.orm
              .select({ message: s.messages, version: s.message_versions })
              .from(s.message_versions)
              .innerJoin(s.messages, eq(s.messages.id, s.message_versions.message_id))
              .where(sql`${s.message_versions.status} != 'complete'`)
              .all();

            for (const row of pending) discardPending(row.message, row.version);
          }
        })
      }
    };
  }
});
