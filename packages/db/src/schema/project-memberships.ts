import type { MaterialId, ProjectId, NoteId } from '@study/contracts/ids';

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
import { materials } from './material-versions.ts';
import { notes } from './notes.ts';
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

export const project_notes = defineTable({ role: 'contributes', entity: 'note' })(
  'project_notes',
  {
    project_id: integer()
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    note_id: integer()
      .$type<NoteId>()
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' })
  },
  (t) => [
    primaryKey({ columns: [t.project_id, t.note_id] }),
    index('project_notes_note_idx').on(t.note_id)
  ]
);

export const note_materials = defineTable({ role: 'contributes', entity: 'material' })(
  'note_materials',
  {
    note_id: integer().$type<NoteId>().notNull(),
    material_id: integer().$type<MaterialId>().notNull(),
    position: integer().$type<bigint>().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.note_id, t.material_id] }),
    foreignKey({
      columns: [t.note_id],
      foreignColumns: [notes.id]
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.material_id],
      foreignColumns: [materials.id]
    }).onDelete('cascade'),
    uniqueIndex('note_materials_position_unique').on(t.note_id, t.position),
    index('note_materials_material_idx').on(t.material_id, t.note_id),
    check('note_materials_position_check', sql`typeof(position) = 'integer' AND position >= 0`)
  ]
);
