import type { ErrorKind } from '@study/contracts/errors';
import type { MaterialVersionId, ProjectId, QuizAttemptId } from '@study/contracts/ids';
import { sql } from 'drizzle-orm';
import { sqliteTable, integer, text, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';

import { sqliteBoolean } from './column-types.ts';
import { material_quiz_attempts } from './learning-content.ts';
import { material_versions } from './material-versions.ts';
import { projects } from './sources.ts';

export const learning_practice_controls = sqliteTable(
  'learning_practice_controls',
  {
    project_id: integer()
      .$type<ProjectId>()
      .primaryKey()
      .references(() => projects.id, { onDelete: 'cascade' }),
    epoch: text().notNull(),
    enabled: sqliteBoolean().notNull()
  },
  (t) => [
    check(
      'learning_practice_control_values',
      sql`length(${t.epoch}) > 0 AND ${t.enabled} IN (0, 1)`
    )
  ]
);

export const learning_practice_slots = sqliteTable(
  'learning_practice_slots',
  {
    id: text().primaryKey(),
    project_id: integer()
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    epoch: text().notNull(),
    ordinal: integer().$type<bigint>().notNull(),
    kind: text({ enum: ['choice', 'open'] }).notNull(),
    status: text({ enum: ['pending', 'ready', 'answered', 'cancelled'] }).notNull(),
    generation_attempt: integer().$type<bigint>().notNull().default(0n),
    failure_kind: text().$type<ErrorKind>(),
    input_version_ids: text().notNull(),
    version_id: integer()
      .$type<MaterialVersionId>()
      .references(() => material_versions.id),
    attempt_id: integer()
      .$type<QuizAttemptId>()
      .references(() => material_quiz_attempts.id)
  },
  (t) => [
    uniqueIndex('learning_practice_slot_ordinal').on(t.project_id, t.epoch, t.ordinal),
    index('learning_practice_slot_status').on(t.project_id, t.epoch, t.status),
    check(
      'learning_practice_slot_values',
      sql`length(${t.id}) > 0 AND length(${t.epoch}) > 0 AND ${t.ordinal} >= 0 AND ${t.kind} IN ('choice', 'open') AND ${t.status} IN ('pending', 'ready', 'answered', 'cancelled') AND json_valid(${t.input_version_ids}) AND ((${t.version_id} IS NULL) = (${t.attempt_id} IS NULL)) AND (${t.status} NOT IN ('ready', 'answered') OR ${t.version_id} IS NOT NULL)`
    )
  ]
);
