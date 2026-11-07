import type { MaterialId, ProjectId, SessionId } from '@study/contracts/ids';

import {
  defineTable,
  sql,
  integer,
  primaryKey,
  index,
  foreignKey,
  uniqueIndex,
  check
} from '../schema-builder.ts';
import { sessions } from './conversations.ts';
import { materials } from './material-versions.ts';
import { projects } from './sources.ts';

/** Flat organizational links. Deleting a collection never deletes library content. */
export const project_materials = defineTable({ role: 'contributes', entity: 'material' })(
  'project_materials',
  {
    project_id: integer()
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    material_id: integer()
      .$type<MaterialId>()
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' })
  },
  (t) => [
    primaryKey({ columns: [t.project_id, t.material_id] }),
    index('project_materials_material_idx').on(t.material_id)
  ]
);

export const project_sessions = defineTable({ role: 'contributes', entity: 'session' })(
  'project_sessions',
  {
    project_id: integer()
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    session_id: integer()
      .$type<SessionId>()
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' })
  },
  (t) => [
    primaryKey({ columns: [t.project_id, t.session_id] }),
    index('project_sessions_session_idx').on(t.session_id)
  ]
);

export const session_materials = defineTable({ role: 'contributes', entity: 'material' })(
  'session_materials',
  {
    session_id: integer().$type<SessionId>().notNull(),
    material_id: integer().$type<MaterialId>().notNull(),
    position: integer().$type<bigint>().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.session_id, t.material_id] }),
    foreignKey({
      columns: [t.session_id],
      foreignColumns: [sessions.id]
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.material_id],
      foreignColumns: [materials.id]
    }).onDelete('cascade'),
    uniqueIndex('session_materials_position_unique').on(t.session_id, t.position),
    index('session_materials_material_idx').on(t.material_id, t.session_id),
    check('session_materials_position_check', sql`typeof(position) = 'integer' AND position >= 0`)
  ]
);
