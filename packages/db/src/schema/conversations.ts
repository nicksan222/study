import { messageFormats } from '@study/contracts/conversations/schemas';
import type {
  MessageId,
  PartId,
  RecordingId,
  SessionId,
  SourceId,
  VersionId
} from '@study/contracts/ids';
import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  integer,
  text,
  blob,
  index,
  uniqueIndex,
  check
} from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

import {
  codes_message_role,
  codes_message_status,
  codes_source_kind,
  codes_title_source,
  codes_version_origin
} from './codes.ts';
import { sources } from './sources.ts';

export const message_versions = sqliteTable(
  'message_versions',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<VersionId>(),
    message_id: messageReference(),
    number: integer().$type<bigint>().notNull(),
    origin: text({ enum: codes_version_origin.code.enumValues })
      .notNull()
      .references((): AnySQLiteColumn => codes_version_origin.code, {
        onDelete: 'no action'
      }),
    instruction: text(),
    /** Content-free provenance survives private capture scrubbing. */
    generation_request_id: text().unique(),
    status: text({ enum: codes_message_status.code.enumValues })
      .notNull()
      .references((): AnySQLiteColumn => codes_message_status.code, {
        onDelete: 'no action'
      }),
    text: text()
      .notNull()
      .default(sql`''`),
    based_on: integer()
      .$type<VersionId>()
      .references((): AnySQLiteColumn => message_versions.id, {
        onDelete: 'set null'
      }),
    created_at: integer().$type<bigint>().notNull()
  },
  (t) => [
    uniqueIndex('message_versions_unfinished_idx')
      .on(t.message_id)
      .where(sql`status != 'complete'`),
    index('message_versions_based_on_idx')
      .on(t.based_on)
      .where(sql`based_on IS NOT NULL`),
    uniqueIndex('message_versions_message_id_number_unique').on(t.message_id, t.number),
    check('message_versions_check_1', sql`number >= 1`),
    check('message_versions_check_2', sql`(origin = 'instruction') = (instruction IS NOT NULL)`),
    check('message_versions_check_3', sql`status = 'complete' OR text = ''`),
    // Match the whitespace removed by JavaScript String.trim().
    check(
      'message_versions_instruction_check',
      sql`instruction IS NULL OR (
        length(trim(instruction, char(9, 10, 11, 12, 13, 32, 160, 5760,
          8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202,
          8232, 8233, 8239, 8287, 12288, 65279))) > 0
        AND length(instruction) <= 100000
      )`
    )
  ]
);

export const message_parts = sqliteTable(
  'message_parts',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<PartId>(),
    message_id: messageReference(),
    ordinal: integer().$type<bigint>().notNull(),
    source_id: integer()
      .$type<SourceId>()
      .references((): AnySQLiteColumn => sources.id, { onDelete: 'set null' }),
    source_name: text().notNull(),
    source_kind: text({ enum: codes_source_kind.code.enumValues })
      .notNull()
      .references((): AnySQLiteColumn => codes_source_kind.code, {
        onDelete: 'no action'
      })
  },
  (t) => [
    index('message_parts_source_idx').on(t.source_id),
    uniqueIndex('message_parts_message_id_ordinal_unique').on(t.message_id, t.ordinal),
    check('message_parts_check_1', sql`ordinal >= 0`)
  ]
);

export const messages = sqliteTable(
  'messages',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<MessageId>(),
    session_id: sessionReference(),
    capture_key: text(),
    format: text({ enum: messageFormats }).notNull().default('text'),
    description: text(),
    role: text({ enum: codes_message_role.code.enumValues })
      .notNull()
      .references((): AnySQLiteColumn => codes_message_role.code, {
        onDelete: 'no action'
      }),
    reply_to: integer()
      .$type<MessageId>()
      .references((): AnySQLiteColumn => messages.id, { onDelete: 'cascade' }),
    thread_root: integer()
      .$type<PartId>()
      .references((): AnySQLiteColumn => message_parts.id, {
        onDelete: 'cascade'
      }),
    recording_ms: integer().$type<bigint>(),
    recording_id: integer()
      .$type<RecordingId>()
      .references((): AnySQLiteColumn => recordings.id, {
        onDelete: 'set null'
      }),
    recorded_in: integer()
      .$type<SourceId>()
      .references((): AnySQLiteColumn => sources.id, { onDelete: 'set null' }),
    active_version_id: integer()
      .$type<VersionId>()
      .references((): AnySQLiteColumn => message_versions.id, {
        onDelete: 'set null'
      }),
    created_at: integer().$type<bigint>().notNull()
  },
  (t) => [
    index('messages_thread_idx')
      .on(t.thread_root, t.id)
      .where(sql`thread_root IS NOT NULL`),
    uniqueIndex('messages_session_capture_key_unique').on(t.session_id, t.capture_key),
    index('messages_session_idx').on(t.session_id, t.id),
    index('messages_recording_idx')
      .on(t.recording_id)
      .where(sql`recording_id IS NOT NULL`),
    index('messages_active_version_idx')
      .on(t.active_version_id)
      .where(sql`active_version_id IS NOT NULL`),
    check('messages_check_1', sql`recording_ms IS NULL OR recording_ms >= 0`),
    check('messages_check_2', sql`(reply_to IS NULL) OR (role = 'assistant')`),
    check('messages_check_3', sql`recording_id IS NULL OR recording_ms IS NOT NULL`)
  ]
);

export const recording_chunks = sqliteTable(
  'recording_chunks',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<bigint>(),
    recording_id: integer()
      .$type<RecordingId>()
      .notNull()
      .references((): AnySQLiteColumn => recordings.id, {
        onDelete: 'cascade'
      }),
    ordinal: integer().$type<bigint>().notNull(),
    pcm: blob({ mode: 'buffer' }).notNull()
  },
  (t) => [
    uniqueIndex('recording_chunks_recording_id_ordinal_unique').on(t.recording_id, t.ordinal),
    check('recording_chunks_check_1', sql`ordinal >= 0`),
    check('recording_chunks_check_2', sql`length(pcm) > 0 AND length(pcm) % 2 = 0`)
  ]
);

export const recordings = sqliteTable(
  'recordings',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<RecordingId>(),
    session_id: sessionReference(),
    started_at: integer().$type<bigint>().notNull(),
    updated_at: integer().$type<bigint>().notNull()
  },
  (t) => [index('recordings_session_idx').on(t.session_id)]
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<SessionId>(),
    title: text().notNull(),
    selection_revision: integer().$type<bigint>().notNull().default(0n),
    selection: text().notNull().default('[]'),
    context_revision: integer().$type<bigint>().notNull().default(0n),
    title_source: text({ enum: codes_title_source.code.enumValues })
      .notNull()
      .references((): AnySQLiteColumn => codes_title_source.code, {
        onDelete: 'no action'
      }),
    created_at: integer().$type<bigint>().notNull(),
    updated_at: integer().$type<bigint>().notNull()
  },
  () => [check('sessions_check_1', sql`length(trim(title)) > 0 AND length(title) <= 200`)]
);

export const conversation_reply_requests = sqliteTable(
  'conversation_reply_requests',
  {
    request_id: text().primaryKey(),
    session_id: integer()
      .$type<SessionId>()
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    version_id: integer()
      .$type<VersionId>()
      .notNull()
      .references(() => message_versions.id, { onDelete: 'cascade' }),
    snapshot: text().notNull()
  },
  (t) => [
    uniqueIndex('conversation_reply_requests_version_idx').on(t.version_id),
    check('conversation_reply_requests_snapshot_json', sql`json_valid(${t.snapshot})`)
  ]
);

function messageReference() {
  return integer()
    .$type<MessageId>()
    .notNull()
    .references((): AnySQLiteColumn => messages.id, { onDelete: 'cascade' });
}

function sessionReference() {
  return integer()
    .$type<SessionId>()
    .notNull()
    .references((): AnySQLiteColumn => sessions.id, { onDelete: 'cascade' });
}

/** Captured context has no execution state; replies use the same request identity. */
export const session_run_contexts = sqliteTable(
  'session_run_contexts',
  {
    request_id: text().primaryKey(),
    session_id: integer()
      .$type<SessionId>()
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    intent_key: text().notNull(),
    intent: text().notNull(),
    snapshot: text().notNull()
  },
  (t) => [
    uniqueIndex('session_run_contexts_intent_unique').on(t.session_id, t.intent_key),
    check('session_run_contexts_json', sql`json_valid(${t.snapshot}) AND json_valid(${t.intent})`)
  ]
);

/** Durable content-free deletion barrier; deliberately outlives the session row. */
export const session_deletions = sqliteTable(
  'session_deletions',
  {
    session_id: integer().$type<SessionId>().primaryKey(),
    operation_id: text().notNull().unique(),
    status: text({ enum: ['pending', 'failed', 'completed'] }).notNull(),
    error_kind: text(),
    attempt: integer().notNull().default(1),
    created_at: integer().$type<bigint>().notNull(),
    completed_at: integer().$type<bigint>()
  },
  (t) => [
    check(
      'session_deletion_state_check',
      sql`${t.attempt} >= 1 AND ${t.status} IN ('pending','failed','completed') AND ((${t.status} = 'completed') = (${t.completed_at} IS NOT NULL)) AND ((${t.status} = 'failed') = (${t.error_kind} IS NOT NULL))`
    )
  ]
);

export const session_deletion_correlations = sqliteTable('session_deletion_correlations', {
  correlation_id: text().primaryKey(),
  session_id: integer()
    .$type<SessionId>()
    .notNull()
    .references(() => session_deletions.session_id)
});

/** Manual sidebar placement belongs to the session and disappears with it. */
export const session_sidebar_preferences = sqliteTable(
  'session_sidebar_preferences',
  {
    session_id: integer()
      .$type<SessionId>()
      .primaryKey()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    settled: integer({ mode: 'boolean' }).notNull()
  },
  (t) => [check('session_sidebar_preferences_settled_check', sql`${t.settled} IN (0, 1)`)]
);
