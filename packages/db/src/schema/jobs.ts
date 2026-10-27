import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  integer,
  text,
  primaryKey,
  index,
  uniqueIndex,
  check
} from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

import { codes_error_kind, codes_job_kind, codes_job_status, codes_requirement } from './codes.ts';
import { messages, sessions } from './conversations.ts';
import { documents } from './documents.ts';
import { artifacts } from './material.ts';
import { practice_questions } from './practice.ts';
import { sources } from './sources.ts';

export const jobs = sqliteTable(
  'jobs',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<bigint>(),
    kind: text({ enum: codes_job_kind.code.enumValues })
      .notNull()
      .references((): AnySQLiteColumn => codes_job_kind.code, {
        onDelete: 'no action'
      }),
    source_id: integer()
      .$type<bigint>()
      .references((): AnySQLiteColumn => sources.id, { onDelete: 'cascade' }),
    document_id: integer()
      .$type<bigint>()
      .references((): AnySQLiteColumn => documents.id, { onDelete: 'cascade' }),
    session_id: integer()
      .$type<bigint>()
      .references((): AnySQLiteColumn => sessions.id, { onDelete: 'cascade' }),
    message_id: integer()
      .$type<bigint>()
      .references((): AnySQLiteColumn => messages.id, { onDelete: 'cascade' }),
    artifact_id: integer()
      .$type<bigint>()
      .references((): AnySQLiteColumn => artifacts.id, { onDelete: 'cascade' }),
    question_id: integer()
      .$type<bigint>()
      .references((): AnySQLiteColumn => practice_questions.id, {
        onDelete: 'cascade'
      }),
    args: text(),
    dedupe_key: text().notNull(),
    status: text({ enum: codes_job_status.code.enumValues })
      .notNull()
      .references((): AnySQLiteColumn => codes_job_status.code, {
        onDelete: 'no action'
      }),
    waiting_for: text({ enum: codes_requirement.code.enumValues }).references(
      (): AnySQLiteColumn => codes_requirement.code,
      { onDelete: 'no action' }
    ),
    attempts: integer()
      .$type<bigint>()
      .notNull()
      .default(sql`0`),
    run_after: integer()
      .$type<bigint>()
      .notNull()
      .default(sql`0`),
    error_kind: text({ enum: codes_error_kind.code.enumValues }).references(
      (): AnySQLiteColumn => codes_error_kind.code,
      { onDelete: 'no action' }
    ),
    error: text(),
    created_at: integer().$type<bigint>().notNull(),
    updated_at: integer().$type<bigint>().notNull(),
    started_at: integer().$type<bigint>(),
    finished_at: integer().$type<bigint>()
  },
  (t) => [
    index('jobs_source_idx').on(t.source_id),
    index('jobs_session_idx').on(t.session_id),
    index('jobs_question_idx').on(t.question_id),
    uniqueIndex('jobs_pending_dedupe_idx')
      .on(t.dedupe_key)
      .where(sql`status IN ('blocked', 'queued', 'waiting')`),
    index('jobs_message_idx').on(t.message_id),
    index('jobs_document_idx').on(t.document_id),
    index('jobs_claim_idx').on(t.status, t.kind, t.run_after, t.id),
    index('jobs_artifact_idx').on(t.artifact_id),
    check('jobs_check_1', sql`args IS NULL OR json_valid(args)`),
    check('jobs_check_2', sql`attempts >= 0`),
    check(
      'jobs_check_3',
      sql`(source_id IS NOT NULL) + (document_id IS NOT NULL) + (session_id IS NOT NULL)
        + (message_id IS NOT NULL) + (artifact_id IS NOT NULL) + (question_id IS NOT NULL) = 1`
    ),
    check('jobs_check_4', sql`(error IS NULL) = (error_kind IS NULL)`),
    check('jobs_check_5', sql`(status = 'waiting') = (waiting_for IS NOT NULL)`),
    check(
      'jobs_kind_target_check',
      sql`(kind IN ('fetch', 'extract') AND source_id IS NOT NULL)
        OR (kind = 'index' AND document_id IS NOT NULL)
        OR (kind = 'title' AND session_id IS NOT NULL)
        OR (kind IN ('reply', 'rewrite') AND message_id IS NOT NULL)
        OR (kind = 'artifact' AND artifact_id IS NOT NULL)
        OR (kind IN ('question', 'grade') AND question_id IS NOT NULL)`
    )
  ]
);

export const job_deps = sqliteTable(
  'job_deps',
  {
    job_id: integer()
      .$type<bigint>()
      .notNull()
      .references((): AnySQLiteColumn => jobs.id, { onDelete: 'cascade' }),
    depends_on: integer()
      .$type<bigint>()
      .notNull()
      .references((): AnySQLiteColumn => jobs.id, { onDelete: 'cascade' })
  },
  (t) => [
    primaryKey({ columns: [t.job_id, t.depends_on] }),
    index('job_deps_depends_on_idx').on(t.depends_on),
    check('job_deps_distinct_check', sql`job_id != depends_on`)
  ]
);
