import type { ErrorKind } from '@study/contracts/errors';
import type { MaterialVersionId, ProjectId, QuizAttemptId } from '@study/contracts/ids';

import {
  defineTable,
  sql,
  integer,
  text,
  uniqueIndex,
  index,
  check,
  primaryKey
} from '../schema-builder.ts';
import { sqliteBoolean } from './column-types.ts';
import { exactContentInputColumns, exactContentInputConstraints } from './exact-content-input.ts';
import { material_quiz_attempts } from './learning-content.ts';
import { material_versions } from './material-versions.ts';
import { projects } from './sources.ts';

export const learning_practice_controls = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
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

export const learning_practice_slots = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
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
    inputs: text().notNull(),
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
      sql`length(${t.id}) > 0 AND length(${t.epoch}) > 0 AND ${t.ordinal} >= 0 AND ${t.kind} IN ('choice', 'open') AND ${t.status} IN ('pending', 'ready', 'answered', 'cancelled') AND json_valid(${t.inputs}) AND ((${t.version_id} IS NULL) = (${t.attempt_id} IS NULL)) AND (${t.status} NOT IN ('ready', 'answered') OR ${t.version_id} IS NOT NULL)`
    )
  ]
);

export const learning_practice_inputs = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
  'learning_practice_inputs',
  {
    slot_id: text()
      .notNull()
      .references(() => learning_practice_slots.id, { onDelete: 'cascade' }),
    position: integer().$type<bigint>().notNull(),
    ...exactContentInputColumns()
  },
  (t) => [
    primaryKey({ columns: [t.slot_id, t.position] }),
    ...exactContentInputConstraints(t),
    index('learning_practice_inputs_document').on(t.page_version_id),
    index('learning_practice_inputs_source').on(
      t.source_id,
      t.source_revision,
      t.source_snapshot_id
    ),
    check('learning_practice_inputs_position', sql`${t.position}>=0`)
  ]
);
