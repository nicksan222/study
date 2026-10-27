import { sql, desc } from 'drizzle-orm';
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

import { codes_question_kind, codes_question_status, codes_verdict } from './codes.ts';
import { projects, sources } from './sources.ts';

export const practices = sqliteTable(
  'practices',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<bigint>(),
    project_id: integer()
      .$type<bigint>()
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    created_at: integer().$type<bigint>().notNull(),
    updated_at: integer().$type<bigint>().notNull()
  },
  (t) => [
    index('practices_updated_idx').on(desc(t.updated_at), desc(t.id)),
    uniqueIndex('practices_project_id_unique').on(t.project_id)
  ]
);

export const practice_questions = sqliteTable(
  'practice_questions',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<bigint>(),
    practice_id: integer()
      .$type<bigint>()
      .notNull()
      .references((): AnySQLiteColumn => practices.id, { onDelete: 'cascade' }),
    ordinal: integer().$type<bigint>().notNull(),
    kind: text({ enum: codes_question_kind.code.enumValues })
      .notNull()
      .references((): AnySQLiteColumn => codes_question_kind.code, {
        onDelete: 'no action'
      }),
    status: text({ enum: codes_question_status.code.enumValues })
      .notNull()
      .references((): AnySQLiteColumn => codes_question_status.code, {
        onDelete: 'no action'
      }),
    body: text(),
    gist: text(),
    choice: integer().$type<bigint>(),
    answer: text(),
    verdict: text({ enum: codes_verdict.code.enumValues }).references(
      (): AnySQLiteColumn => codes_verdict.code,
      { onDelete: 'no action' }
    ),
    feedback: text(),
    created_at: integer().$type<bigint>().notNull(),
    answered_at: integer().$type<bigint>(),
    graded_at: integer().$type<bigint>()
  },
  (t) => [
    uniqueIndex('practice_questions_practice_id_ordinal_unique').on(t.practice_id, t.ordinal),
    check('practice_questions_check_1', sql`ordinal >= 0`),
    check('practice_questions_check_2', sql`body IS NULL OR json_valid(body)`),
    check('practice_questions_check_3', sql`length(trim(gist)) > 0 AND length(gist) <= 200`),
    check('practice_questions_check_4', sql`choice >= 0`),
    check('practice_questions_check_5', sql`length(trim(answer)) > 0`),
    check('practice_questions_check_6', sql`length(trim(feedback)) > 0`),
    check(
      'practice_questions_check_7',
      sql`(body IS NULL) = (status = 'pending' OR status = 'writing')`
    ),
    check('practice_questions_check_8', sql`(gist IS NULL) = (body IS NULL)`),
    check(
      'practice_questions_check_9',
      sql`(answered_at IS NOT NULL) = (status = 'answered' OR status = 'graded')`
    ),
    check(
      'practice_questions_check_10',
      sql`(choice IS NOT NULL) = (answered_at IS NOT NULL AND kind = 'choice')`
    ),
    check(
      'practice_questions_check_11',
      sql`(answer IS NOT NULL) = (answered_at IS NOT NULL AND kind = 'open')`
    ),
    check('practice_questions_check_12', sql`(status = 'answered') <= (kind = 'open')`),
    check('practice_questions_check_13', sql`(graded_at IS NOT NULL) = (status = 'graded')`),
    check('practice_questions_check_14', sql`(verdict IS NOT NULL) = (status = 'graded')`),
    check('practice_questions_check_15', sql`(verdict = 'partly') <= (kind = 'open')`),
    check(
      'practice_questions_check_16',
      sql`(feedback IS NOT NULL) = (status = 'graded' AND kind = 'open')`
    )
  ]
);

export const question_citations = sqliteTable(
  'question_citations',
  {
    question_id: integer()
      .$type<bigint>()
      .notNull()
      .references((): AnySQLiteColumn => practice_questions.id, {
        onDelete: 'cascade'
      }),
    marker: integer().$type<bigint>().notNull(),
    source_id: integer()
      .$type<bigint>()
      .references((): AnySQLiteColumn => sources.id, { onDelete: 'set null' }),
    source_name: text().notNull(),
    anchor: text().notNull(),
    quote: text().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.question_id, t.marker] }),
    index('question_citations_source_idx').on(t.source_id),
    check('question_citations_check_1', sql`marker BETWEEN 1 AND 4294967295`),
    check('question_citations_check_2', sql`json_valid(anchor)`)
  ]
);
