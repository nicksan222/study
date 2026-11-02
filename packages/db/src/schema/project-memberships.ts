import type { MaterialId, ProjectId, SessionId } from '@study/contracts/ids';
import { integer, primaryKey, index, sqliteTable } from 'drizzle-orm/sqlite-core';

import { sessions } from './conversations.ts';
import { materials } from './material-versions.ts';
import { projects } from './sources.ts';

/** Flat organizational links. Deleting a collection never deletes library content. */
export const project_materials = sqliteTable(
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

export const project_sessions = sqliteTable(
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
