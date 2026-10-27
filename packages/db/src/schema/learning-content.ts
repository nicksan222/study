import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  integer,
  real,
  text,
  primaryKey,
  uniqueIndex,
  index,
  check,
  foreignKey
} from 'drizzle-orm/sqlite-core';

import { sqliteBoolean } from './column-types.ts';
import { materials, material_versions } from './material-versions.ts';

export const material_quiz_versions = sqliteTable(
  'material_quiz_versions',
  {
    version_id: integer().$type<bigint>().primaryKey(),
    kind: text({ enum: ['quiz'] })
      .notNull()
      .default('quiz')
  },
  (t) => [
    check('material_quiz_versions_kind', sql`kind = 'quiz'`),
    foreignKey({
      columns: [t.version_id, t.kind],
      foreignColumns: [material_versions.id, material_versions.kind]
    })
      .onDelete('cascade')
      .onUpdate('restrict')
  ]
);

export const material_quiz_questions = sqliteTable(
  'material_quiz_questions',
  {
    id: integer().$type<bigint>().primaryKey({ autoIncrement: true }),
    version_id: integer().$type<bigint>().notNull(),
    position: integer().$type<bigint>().notNull(),
    kind: text({ enum: ['single_choice', 'multiple_choice', 'open'] }).notNull(),
    prompt: text().notNull(),
    explanation: text().notNull()
  },
  (t) => [
    foreignKey({ columns: [t.version_id], foreignColumns: [material_quiz_versions.version_id] })
      .onDelete('cascade')
      .onUpdate('restrict'),
    uniqueIndex('material_quiz_questions_position').on(t.version_id, t.position),
    uniqueIndex('material_quiz_questions_version').on(t.id, t.version_id),
    uniqueIndex('material_quiz_questions_kind').on(t.id, t.kind),
    check(
      'material_quiz_questions_values',
      sql`typeof(position) = 'integer' AND typeof(position) = 'integer' AND position >= 0 AND kind IN ('single_choice','multiple_choice','open') AND length(trim(prompt)) > 0 AND length(trim(explanation)) > 0`
    )
  ]
);

export const material_quiz_choices = sqliteTable(
  'material_quiz_choices',
  {
    id: integer().$type<bigint>().primaryKey({ autoIncrement: true }),
    question_id: integer().$type<bigint>().notNull(),
    question_kind: text({ enum: ['single_choice', 'multiple_choice'] }).notNull(),
    position: integer().$type<bigint>().notNull(),
    text: text().notNull(),
    is_correct: sqliteBoolean().notNull().default(false)
  },
  (t) => [
    foreignKey({
      columns: [t.question_id, t.question_kind],
      foreignColumns: [material_quiz_questions.id, material_quiz_questions.kind]
    })
      .onDelete('cascade')
      .onUpdate('restrict'),
    uniqueIndex('material_quiz_choices_position').on(t.question_id, t.position),
    uniqueIndex('material_quiz_choices_question').on(t.id, t.question_id),
    check(
      'material_quiz_choices_values',
      sql`question_kind IN ('single_choice','multiple_choice') AND typeof(position) = 'integer' AND position >= 0 AND length(trim(text)) > 0 AND is_correct IN (0,1)`
    )
  ]
);

export const material_quiz_open_answers = sqliteTable(
  'material_quiz_open_answers',
  {
    question_id: integer().$type<bigint>().primaryKey(),
    kind: text({ enum: ['open'] })
      .notNull()
      .default('open'),
    reference_answer: text().notNull()
  },
  (t) => [
    foreignKey({
      columns: [t.question_id, t.kind],
      foreignColumns: [material_quiz_questions.id, material_quiz_questions.kind]
    })
      .onDelete('cascade')
      .onUpdate('restrict'),
    check(
      'material_quiz_open_answers_values',
      sql`kind = 'open' AND length(trim(reference_answer)) > 0`
    )
  ]
);

export const material_flashcard_versions = sqliteTable(
  'material_flashcard_versions',
  {
    version_id: integer().$type<bigint>().primaryKey(),
    material_id: integer().$type<bigint>().notNull(),
    kind: text({ enum: ['flashcards'] })
      .notNull()
      .default('flashcards')
  },
  (t) => [
    foreignKey({
      columns: [t.version_id, t.material_id, t.kind],
      foreignColumns: [material_versions.id, material_versions.material_id, material_versions.kind]
    })
      .onDelete('cascade')
      .onUpdate('restrict'),
    uniqueIndex('material_flashcard_versions_material').on(t.version_id, t.material_id),
    index('material_flashcard_versions_material_fk').on(t.material_id),
    check('material_flashcard_versions_kind', sql`kind = 'flashcards'`)
  ]
);

export const material_card_identities = sqliteTable(
  'material_card_identities',
  {
    id: integer().$type<bigint>().primaryKey({ autoIncrement: true }),
    material_id: integer().$type<bigint>().notNull(),
    kind: text({ enum: ['flashcards'] })
      .notNull()
      .default('flashcards')
  },
  (t) => [
    foreignKey({ columns: [t.material_id, t.kind], foreignColumns: [materials.id, materials.kind] })
      .onDelete('cascade')
      .onUpdate('restrict'),
    uniqueIndex('material_card_identities_material').on(t.id, t.material_id),
    index('material_card_identities_material_fk').on(t.material_id, t.kind),
    check('material_card_identities_kind', sql`kind = 'flashcards'`)
  ]
);

export const material_flashcard_entries = sqliteTable(
  'material_flashcard_entries',
  {
    version_id: integer().$type<bigint>().notNull(),
    material_id: integer().$type<bigint>().notNull(),
    card_id: integer().$type<bigint>().notNull(),
    position: integer().$type<bigint>().notNull(),
    front: text().notNull(),
    back: text().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.version_id, t.card_id] }),
    foreignKey({
      columns: [t.version_id, t.material_id],
      foreignColumns: [
        material_flashcard_versions.version_id,
        material_flashcard_versions.material_id
      ]
    })
      .onDelete('cascade')
      .onUpdate('restrict'),
    foreignKey({
      columns: [t.card_id, t.material_id],
      foreignColumns: [material_card_identities.id, material_card_identities.material_id]
    })
      .onDelete('cascade')
      .onUpdate('restrict'),
    uniqueIndex('material_flashcard_entries_position').on(t.version_id, t.position),
    index('material_flashcard_entries_card_fk').on(t.card_id, t.material_id),
    check(
      'material_flashcard_entries_values',
      sql`typeof(position) = 'integer' AND typeof(position) = 'integer' AND position >= 0 AND length(trim(front)) > 0 AND length(trim(back)) > 0`
    )
  ]
);

export const material_quiz_attempts = sqliteTable(
  'material_quiz_attempts',
  {
    id: integer().$type<bigint>().primaryKey({ autoIncrement: true }),
    version_id: integer().$type<bigint>().notNull(),
    status: text({ enum: ['in_progress', 'completed'] }).notNull(),
    started_at: integer().$type<bigint>().notNull(),
    finished_at: integer().$type<bigint>()
  },
  (t) => [
    foreignKey({ columns: [t.version_id], foreignColumns: [material_quiz_versions.version_id] })
      .onDelete('cascade')
      .onUpdate('restrict'),
    uniqueIndex('material_quiz_attempts_version').on(t.id, t.version_id),
    index('material_quiz_attempts_version_fk').on(t.version_id),
    check(
      'material_quiz_attempts_values',
      sql`status IN ('in_progress','completed') AND typeof(started_at) = 'integer' AND started_at >= 0 AND (finished_at IS NULL OR (typeof(finished_at) = 'integer' AND finished_at >= started_at)) AND ((status = 'completed' AND finished_at IS NOT NULL) OR (status = 'in_progress' AND finished_at IS NULL))`
    )
  ]
);

export const material_quiz_responses = sqliteTable(
  'material_quiz_responses',
  {
    attempt_id: integer().$type<bigint>().notNull(),
    version_id: integer().$type<bigint>().notNull(),
    question_id: integer().$type<bigint>().notNull(),
    question_kind: text({ enum: ['single_choice', 'multiple_choice', 'open'] }).notNull(),
    answer: text(),
    score: real(),
    feedback: text()
  },
  (t) => [
    primaryKey({ columns: [t.attempt_id, t.question_id] }),
    foreignKey({
      columns: [t.attempt_id, t.version_id],
      foreignColumns: [material_quiz_attempts.id, material_quiz_attempts.version_id]
    })
      .onDelete('cascade')
      .onUpdate('restrict'),
    foreignKey({
      columns: [t.question_id, t.version_id],
      foreignColumns: [material_quiz_questions.id, material_quiz_questions.version_id]
    })
      .onDelete('cascade')
      .onUpdate('restrict'),
    foreignKey({
      columns: [t.question_id, t.question_kind],
      foreignColumns: [material_quiz_questions.id, material_quiz_questions.kind]
    })
      .onDelete('cascade')
      .onUpdate('restrict'),
    index('material_quiz_responses_question_version_fk').on(t.question_id, t.version_id),
    index('material_quiz_responses_question_kind_fk').on(t.question_id, t.question_kind),
    check(
      'material_quiz_responses_values',
      sql`question_kind IN ('single_choice','multiple_choice','open') AND (score IS NULL OR score BETWEEN 0 AND 1) AND ((question_kind = 'open' AND answer IS NOT NULL AND length(trim(answer)) > 0) OR (question_kind IN ('single_choice','multiple_choice') AND answer IS NULL))`
    )
  ]
);

export const material_quiz_selections = sqliteTable(
  'material_quiz_selections',
  {
    attempt_id: integer().$type<bigint>().notNull(),
    question_id: integer().$type<bigint>().notNull(),
    choice_id: integer().$type<bigint>().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.attempt_id, t.question_id, t.choice_id] }),
    foreignKey({
      columns: [t.attempt_id, t.question_id],
      foreignColumns: [material_quiz_responses.attempt_id, material_quiz_responses.question_id]
    })
      .onDelete('cascade')
      .onUpdate('restrict'),
    foreignKey({
      columns: [t.choice_id, t.question_id],
      foreignColumns: [material_quiz_choices.id, material_quiz_choices.question_id]
    })
      .onDelete('cascade')
      .onUpdate('restrict'),
    index('material_quiz_selections_choice_fk').on(t.choice_id, t.question_id)
  ]
);

export const material_card_schedules = sqliteTable(
  'material_card_schedules',
  {
    card_id: integer().$type<bigint>().primaryKey(),
    due: integer().$type<bigint>().notNull(),
    last_review: integer().$type<bigint>(),
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
      .default(sql`0`),
    state: text({ enum: ['new', 'learning', 'review', 'relearning'] }).notNull(),
    stability: real().notNull(),
    difficulty: real().notNull(),
    reps: integer().$type<bigint>().notNull(),
    lapses: integer().$type<bigint>().notNull()
  },
  (t) => [
    foreignKey({ columns: [t.card_id], foreignColumns: [material_card_identities.id] })
      .onDelete('cascade')
      .onUpdate('restrict'),
    index('material_card_schedules_due').on(t.due),
    check(
      'material_card_schedules_values',
      sql`typeof(due) = 'integer' AND due >= 0 AND state IN ('new','learning','review','relearning') AND stability >= 0 AND stability <= 36500 AND difficulty BETWEEN 1 AND 10 AND typeof(reps) = 'integer' AND typeof(lapses) = 'integer' AND reps >= 0 AND lapses BETWEEN 0 AND reps AND (last_review IS NULL OR (typeof(last_review) = 'integer' AND last_review >= 0)) AND typeof(elapsed_days) = 'integer' AND elapsed_days >= 0 AND typeof(scheduled_days) = 'integer' AND scheduled_days >= 0 AND typeof(learning_steps) = 'integer' AND learning_steps >= 0`
    )
  ]
);

export const material_card_reviews = sqliteTable(
  'material_card_reviews',
  {
    id: integer().$type<bigint>().primaryKey({ autoIncrement: true }),
    card_id: integer().$type<bigint>().notNull(),
    version_id: integer().$type<bigint>().notNull(),
    reviewed_at: integer().$type<bigint>().notNull(),
    rating: text({ enum: ['again', 'hard', 'good', 'easy'] }).notNull(),
    elapsed_days: real().notNull()
  },
  (t) => [
    foreignKey({
      columns: [t.version_id, t.card_id],
      foreignColumns: [material_flashcard_entries.version_id, material_flashcard_entries.card_id]
    })
      .onDelete('cascade')
      .onUpdate('restrict'),
    index('material_card_reviews_entry_fk').on(t.version_id, t.card_id),
    index('material_card_reviews_card_time').on(t.card_id, t.reviewed_at),
    check(
      'material_card_reviews_values',
      sql`typeof(reviewed_at) = 'integer' AND reviewed_at >= 0 AND rating IN ('again','hard','good','easy') AND elapsed_days >= 0`
    )
  ]
);
