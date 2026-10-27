import { sql, desc } from 'drizzle-orm';
import {
  sqliteTable,
  integer,
  text,
  real,
  primaryKey,
  index,
  uniqueIndex,
  check
} from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

import { codes_artifact_kind, codes_artifact_status, codes_rating } from './codes.ts';
import { material_card_identities } from './learning-content.ts';
import { materials } from './material-versions.ts';
import { practice_questions, practices } from './practice.ts';
import { projects, sources } from './sources.ts';

export const artifacts = sqliteTable(
  'artifacts',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<bigint>(),
    project_id: integer()
      .$type<bigint>()
      .notNull()
      .references((): AnySQLiteColumn => projects.id, { onDelete: 'cascade' }),
    material_id: integer()
      .$type<bigint>()
      .references((): AnySQLiteColumn => materials.id, { onDelete: 'set null' }),
    practice_id: integer()
      .$type<bigint>()
      .references((): AnySQLiteColumn => practices.id, {
        onDelete: 'set null'
      }),
    kind: text({ enum: codes_artifact_kind.code.enumValues })
      .notNull()
      .references((): AnySQLiteColumn => codes_artifact_kind.code, {
        onDelete: 'no action'
      }),
    mistakes: integer()
      .$type<bigint>()
      .notNull()
      .default(sql`0`),
    title: text().notNull(),
    notes: text()
      .notNull()
      .default(sql`''`),
    status: text({ enum: codes_artifact_status.code.enumValues })
      .notNull()
      .references((): AnySQLiteColumn => codes_artifact_status.code, {
        onDelete: 'no action'
      }),
    body: text(),
    created_at: integer().$type<bigint>().notNull(),
    updated_at: integer().$type<bigint>().notNull()
  },
  (t) => [
    uniqueIndex('artifacts_update_idx')
      .on(t.project_id, t.kind)
      .where(sql`mistakes = 0 AND status != 'complete'`),
    index('artifacts_material_idx').on(t.material_id),
    index('artifacts_project_idx').on(t.project_id, desc(t.id)),
    uniqueIndex('artifacts_piece_idx')
      .on(t.project_id, t.kind)
      .where(sql`mistakes = 0 AND status = 'complete'`),
    uniqueIndex('artifacts_practice_id_unique').on(t.practice_id),
    check('artifacts_check_1', sql`mistakes IN (0, 1)`),
    check('artifacts_check_2', sql`length(trim(title)) > 0 AND length(title) <= 200`),
    check('artifacts_check_3', sql`body IS NULL OR json_valid(body)`),
    check('artifacts_check_4', sql`(status = 'complete') = (body IS NOT NULL)`),
    check('artifacts_check_5', sql`practice_id IS NULL OR mistakes = 1`)
  ]
);

export const artifact_sources = sqliteTable(
  'artifact_sources',
  {
    artifact_id: integer()
      .$type<bigint>()
      .notNull()
      .references((): AnySQLiteColumn => artifacts.id, { onDelete: 'cascade' }),
    source_id: integer()
      .$type<bigint>()
      .references((): AnySQLiteColumn => sources.id, { onDelete: 'set null' })
  },
  (t) => [
    uniqueIndex('artifact_sources_unique_idx')
      .on(t.artifact_id, t.source_id)
      .where(sql`source_id IS NOT NULL`),
    index('artifact_sources_source_idx').on(t.source_id)
  ]
);

export const artifact_citations = sqliteTable(
  'artifact_citations',
  {
    artifact_id: integer()
      .$type<bigint>()
      .notNull()
      .references((): AnySQLiteColumn => artifacts.id, { onDelete: 'cascade' }),
    marker: integer().$type<bigint>().notNull(),
    source_id: integer()
      .$type<bigint>()
      .references((): AnySQLiteColumn => sources.id, { onDelete: 'set null' }),
    source_name: text().notNull(),
    anchor: text().notNull(),
    quote: text().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.artifact_id, t.marker] }),
    index('artifact_citations_source_idx').on(t.source_id),
    check('artifact_citations_check_1', sql`marker BETWEEN 1 AND 4294967295`),
    check('artifact_citations_check_2', sql`json_valid(anchor)`)
  ]
);

export const cards = sqliteTable(
  'cards',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<bigint>(),
    material_card_id: integer()
      .$type<bigint>()
      .references((): AnySQLiteColumn => material_card_identities.id, { onDelete: 'set null' }),
    artifact_id: integer()
      .$type<bigint>()
      .notNull()
      .references((): AnySQLiteColumn => artifacts.id, { onDelete: 'cascade' }),
    ordinal: integer().$type<bigint>().notNull(),
    front: text().notNull(),
    back: text().notNull(),
    stability: real()
      .notNull()
      .default(sql`0`),
    difficulty: real()
      .notNull()
      .default(sql`0`),
    reps: integer()
      .$type<bigint>()
      .notNull()
      .default(sql`0`),
    lapses: integer()
      .$type<bigint>()
      .notNull()
      .default(sql`0`),
    last_review: integer().$type<bigint>(),
    due: integer().$type<bigint>().notNull(),
    cites: text()
      .notNull()
      .default(sql`'[]'`),
    question_id: integer()
      .$type<bigint>()
      .references((): AnySQLiteColumn => practice_questions.id, {
        onDelete: 'set null'
      }),
    state: integer()
      .$type<bigint>()
      .notNull()
      .default(sql`0`),
    elapsed_days: integer()
      .$type<bigint>()
      .notNull()
      .default(sql`0`),
    scheduled_days: integer()
      .$type<bigint>()
      .notNull()
      .default(sql`0`),
    learning_steps: integer()
      .$type<bigint>()
      .notNull()
      .default(sql`0`)
  },
  (t) => [
    uniqueIndex('cards_question_idx').on(t.question_id),
    index('cards_material_card_idx').on(t.material_card_id),
    index('cards_due_idx').on(t.due),
    uniqueIndex('cards_artifact_id_ordinal_unique').on(t.artifact_id, t.ordinal),
    check('cards_check_1', sql`ordinal >= 0`),
    check('cards_check_2', sql`length(trim(front)) > 0`),
    check('cards_check_3', sql`length(trim(back)) > 0`),
    check('cards_check_4', sql`stability >= 0`),
    check('cards_check_5', sql`difficulty >= 0 AND difficulty <= 10`),
    check('cards_check_6', sql`reps >= 0`),
    check('cards_check_7', sql`lapses >= 0`),
    check('cards_check_8', sql`json_valid(cites)`),
    check('cards_state_check', sql`state IN (0, 1, 2, 3)`),
    check('cards_elapsed_days_check', sql`elapsed_days >= 0`),
    check('cards_scheduled_days_check', sql`scheduled_days >= 0`),
    check('cards_learning_steps_check', sql`learning_steps >= 0`)
  ]
);

export const reviews = sqliteTable(
  'reviews',
  {
    id: integer().primaryKey({ autoIncrement: true }).$type<bigint>(),
    card_id: integer()
      .$type<bigint>()
      .notNull()
      .references((): AnySQLiteColumn => cards.id, { onDelete: 'cascade' }),
    rating: text({ enum: codes_rating.code.enumValues })
      .notNull()
      .references((): AnySQLiteColumn => codes_rating.code, {
        onDelete: 'no action'
      }),
    reviewed_at: integer().$type<bigint>().notNull(),
    stability: real().notNull(),
    difficulty: real().notNull(),
    elapsed_days: real().notNull()
  },
  (t) => [
    index('reviews_card_idx').on(t.card_id, t.reviewed_at),
    check('reviews_check_1', sql`elapsed_days >= 0`)
  ]
);

export const artifact_note_snapshots = sqliteTable(
  'artifact_note_snapshots',
  {
    artifact_id: integer()
      .$type<bigint>()
      .notNull()
      .references((): AnySQLiteColumn => artifacts.id, { onDelete: 'cascade' }),
    message_id: integer().$type<bigint>().notNull(),
    version_id: integer().$type<bigint>().notNull()
  },
  (t) => [primaryKey({ columns: [t.artifact_id, t.message_id] })]
);
