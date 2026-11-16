/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Validates retained note payloads and note cleanup readiness for managed            │
 * │ backup snapshots.                                                                        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Decodes selections, captures, replies and citation anchors without resuming work.      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Notes owns these read checks; runtime invokes only its public transaction                │
 * │ participant.                                                                             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts';
import {
  noteContextIntentSchema,
  runSelectionContextSchema,
  selectionTargetsSchema
} from '@study/contracts';
import { replySnapshotSchema } from '@study/contracts';
import { anchorSchema } from '@study/contracts';
import { eq, sql } from '@study/db';
import * as s from '@study/db';
import { defineStore, storeQuery } from '@study/server';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

function makeCaptureValidation({ db }: StoreResources) {
  const context = Schema.decodeUnknownSync(
    Schema.fromJsonString(Schema.toCodecJson(runSelectionContextSchema))
  );

  const intent = Schema.decodeUnknownSync(
    Schema.fromJsonString(Schema.toCodecJson(noteContextIntentSchema))
  );

  return (row: typeof s.note_run_contexts.$inferSelect, requireRetired: boolean) => {
    const captured = context(row.snapshot);

    const requested = intent(row.intent);

    if (
      captured.requestId !== row.request_id ||
      captured.noteId !== row.note_id ||
      captured.intentKey !== row.intent_key ||
      captured.askDigest !== requested.askDigest ||
      requested.noteId !== row.note_id ||
      requested.intentKey !== row.intent_key
    )
      throw new StudyError('invalid_input', 'Backup capture identity is invalid');

    if (
      requireRetired &&
      !db.orm.get(
        sql`SELECT 1 FROM workflow_retired_correlations WHERE correlation_id=${row.request_id} AND event_type='NoteGenerationRequested'`
      )
    )
      throw new StudyError('invalid_input', 'Backup contains actionable note capture');
  };
}

function makeReplyValidation({ db }: StoreResources) {
  return (row: typeof s.note_reply_requests.$inferSelect) => {
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
      captured.noteId !== row.note_id ||
      captured.versionId !== row.version_id ||
      !version ||
      version.message_id !== captured.messageId ||
      (version.generation_request_id !== null && version.generation_request_id !== row.request_id)
    )
      throw new StudyError('invalid_input', 'Backup reply provenance is invalid');
  };
}

export const NoteBackupStore = defineStore({
  name: 'study/NoteBackupStore',
  entity: { singular: 'backupNote', plural: 'backupNotes' },
  make: (resources) => {
    const { db } = resources;

    const validateCapture = makeCaptureValidation(resources);
    const validateReply = makeReplyValidation(resources);

    return {
      queries: {
        backupNote: storeQuery({
          role: 'required',
          input: Schema.Boolean,
          output: Schema.Boolean,
          run: (requireRetired) => {
            if (db.orm.get(sql`SELECT 1 FROM note_deletions WHERE status != 'completed' LIMIT 1`))
              throw new StudyError('invalid_input', 'Backup requires completed note cleanup');

            const selection = Schema.decodeUnknownSync(
              Schema.fromJsonString(Schema.toCodecJson(selectionTargetsSchema))
            );

            for (const row of db.orm.select().from(s.notes).all()) selection(row.selection);

            for (const row of db.orm.select().from(s.note_run_contexts).all()) {
              validateCapture(row, requireRetired);
            }

            for (const row of db.orm.select().from(s.note_reply_requests).all()) {
              validateReply(row);
            }

            for (const row of db.orm.select().from(s.citations).all())
              Schema.decodeUnknownSync(anchorSchema)(JSON.parse(row.anchor));

            return true;
          }
        })
      },
      mutations: {}
    };
  }
});
