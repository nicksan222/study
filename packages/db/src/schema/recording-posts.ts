import type { MessageId, ProjectId, RecordingId, SessionId, SourceId } from '@study/contracts/ids';
import { sql } from 'drizzle-orm';
import { blob, check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { recordings, sessions } from './conversations.ts';
import { projects } from './sources.ts';

/** Immutable recording input and a durable publication receipt; execution belongs to Workflow. */
export const recording_posts = sqliteTable(
  'recording_posts',
  {
    request_id: text().primaryKey(),
    recording_id: integer()
      .$type<RecordingId>()
      .notNull()
      .references(() => recordings.id, { onDelete: 'cascade' }),
    session_id: integer()
      .$type<SessionId>()
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    project_id: integer()
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    wav: blob({ mode: 'buffer' }).notNull(),
    duration_ms: integer().$type<bigint>().notNull(),
    source_id: integer().$type<SourceId>(),
    message_id: integer().$type<MessageId>(),
    created_at: integer().$type<bigint>().notNull()
  },
  (t) => [
    uniqueIndex('recording_posts_recording_unique').on(t.recording_id),
    check('recording_posts_request_check', sql`length(trim(${t.request_id})) > 0`),
    check('recording_posts_name_check', sql`length(trim(${t.name})) BETWEEN 1 AND 255`),
    check('recording_posts_wav_check', sql`length(${t.wav}) BETWEEN 46 AND 115200044`),
    check('recording_posts_duration_check', sql`${t.duration_ms} BETWEEN 0 AND 3600000`),
    check(
      'recording_posts_result_pair_check',
      sql`(${t.source_id} IS NULL) = (${t.message_id} IS NULL)`
    )
  ]
);
