/** @file Owns projects within this feature. */

import {
  StudyError,
  automaticProjectIcon,
  createProjectInputSchema as createInput,
  projectIdInputSchema as deleteInput,
  setExamInputSchema as examInput,
  projectIconSchema,
  projectIdSchema,
  projectMaterialInputSchema,
  projectNoteInputSchema,
  projectPageInputSchema,
  projectSchema,
  renameProjectInputSchema as renameInput,
  setProjectIconInputSchema
} from '@study/contracts';
import {
  and,
  desc,
  eq,
  lt,
  materials,
  notes,
  project_materials,
  project_notes,
  projects
} from '@study/db';
import { storeMutation, storeQuery, unixSeconds } from '@study/server';
import type { StoreResources } from '@study/server';
import { Option, Schema } from 'effect';

/** Decodes persisted glyph variants and colors through the canonical icon schema. */
const row = (value: typeof projects.$inferSelect) => ({
  id: value.id,
  name: value.name,
  icon: Schema.decodeUnknownSync(projectIconSchema)(
    value.icon === null
      ? { kind: 'automatic', color: value.icon_color }
      : { kind: value.icon_kind, value: value.icon, color: value.icon_color }
  ),
  examOn: value.exam_on,
  createdAt: value.created_at,
  updatedAt: value.updated_at
});

/** Maps stored project rows behind the typed feature boundary for exact-ID reads. */
function makeHelpers({ db }: StoreResources) {
  const find = (id: typeof projectIdSchema.Type) => {
    const value = db.orm.select().from(projects).where(eq(projects.id, id)).get();

    return value ? row(value) : null;
  };

  return { find };
}

const filter = projectPageInputSchema;

export function makeProjectsStore({ db, clock, timestampClock }: StoreResources) {
  const { find } = makeHelpers({ db, clock, timestampClock });

  const assertProject = (id: typeof projectIdSchema.Type) => {
    if (!find(id)) throw new StudyError('not_found', 'Collection not found');
  };
  const materialMembership = (input: typeof projectMaterialInputSchema.Type, add: boolean) => {
    assertProject(input.projectId);

    if (!db.orm.select().from(materials).where(eq(materials.id, input.materialId)).get())
      throw new StudyError('not_found', 'Material not found');

    if (add)
      db.orm
        .insert(project_materials)
        .values({ project_id: input.projectId, material_id: input.materialId })
        .onConflictDoNothing()
        .run();
    else
      db.orm
        .delete(project_materials)
        .where(
          and(
            eq(project_materials.project_id, input.projectId),
            eq(project_materials.material_id, input.materialId)
          )
        )
        .run();
  };
  const noteMembership = (input: typeof projectNoteInputSchema.Type, add: boolean) => {
    assertProject(input.projectId);

    if (!db.orm.select().from(notes).where(eq(notes.id, input.noteId)).get())
      throw new StudyError('not_found', 'Note not found');

    if (add)
      db.orm
        .insert(project_notes)
        .values({ project_id: input.projectId, note_id: input.noteId })
        .onConflictDoNothing()
        .run();
    else
      db.orm
        .delete(project_notes)
        .where(
          and(
            eq(project_notes.project_id, input.projectId),
            eq(project_notes.note_id, input.noteId)
          )
        )
        .run();
  };

  const create = (input: typeof createInput.Type) => {
    const timestamp = unixSeconds(timestampClock);
    const result = db.orm
      .insert(projects)
      .values({ name: input.name, created_at: timestamp, updated_at: timestamp })
      .run();

    return {
      id: Schema.decodeUnknownSync(projectIdSchema)(BigInt(result.lastInsertRowid)),
      name: input.name,
      icon: automaticProjectIcon,
      examOn: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  };

  return {
    queries: {
      project: storeQuery({
        role: 'required',
        input: projectIdSchema,
        output: projectSchema,
        run: (id) => find(id)!
      }),
      findProject: storeQuery({
        role: 'optional',
        input: projectIdSchema,
        output: Schema.Option(projectSchema),
        run: (id) => Option.fromNullishOr(find(id))
      }),
      projects: storeQuery({
        role: 'collection',
        input: filter,
        output: Schema.Array(projectSchema),
        run: (input) =>
          db.orm
            .select()
            .from(projects)
            .where(input.before === undefined ? undefined : lt(projects.id, input.before))
            .orderBy(desc(projects.id))
            .limit(input.limit)
            .all()
            .map(row)
      })
    },
    mutations: {
      addMaterial: storeMutation({
        changes: ['projects'],
        input: projectMaterialInputSchema,
        output: Schema.Void,
        run: (input) => materialMembership(input, true)
      }),
      removeMaterial: storeMutation({
        changes: ['projects'],
        input: projectMaterialInputSchema,
        output: Schema.Void,
        run: (input) => materialMembership(input, false)
      }),
      addNote: storeMutation({
        changes: ['projects'],
        input: projectNoteInputSchema,
        output: Schema.Void,
        run: (input) => noteMembership(input, true)
      }),
      removeNote: storeMutation({
        changes: ['projects'],
        input: projectNoteInputSchema,
        output: Schema.Void,
        run: (input) => noteMembership(input, false)
      }),
      ensureProject: storeMutation({
        changes: ['projects'],
        input: createInput,
        output: projectSchema,
        run: (input) => {
          const existing = db.orm
            .select()
            .from(projects)
            .where(eq(projects.name, input.name))
            .orderBy(projects.id)
            .get();

          if (existing) return row(existing);

          return create(input);
        }
      }),
      createProject: storeMutation({
        changes: ['projects'],
        input: createInput,
        output: projectSchema,
        run: create
      }),
      renameProject: storeMutation({
        changes: ['projects'],
        input: renameInput,
        output: Schema.Boolean,
        run: (input) =>
          db.orm
            .update(projects)
            .set({ name: input.name, updated_at: unixSeconds(timestampClock) })
            .where(eq(projects.id, input.id))
            .run().changes !== 0
      }),
      deleteProject: storeMutation({
        changes: ['projects'],
        input: deleteInput,
        output: Schema.Boolean,
        run: (input) => db.orm.delete(projects).where(eq(projects.id, input.id)).run().changes !== 0
      }),
      setIcon: storeMutation({
        changes: ['projects'],
        input: setProjectIconInputSchema,
        output: projectSchema,
        run: (input) => {
          if (!find(input.id)) throw new StudyError('not_found', 'Subject not found');

          db.orm
            .update(projects)
            .set({
              icon: input.icon.kind === 'automatic' ? null : input.icon.value,
              icon_kind: input.icon.kind === 'automatic' ? 'monogram' : input.icon.kind,
              icon_color: input.icon.color,
              updated_at: unixSeconds(timestampClock)
            })
            .where(eq(projects.id, input.id))
            .run();

          return find(input.id)!;
        }
      }),
      setExam: storeMutation({
        changes: ['projects'],
        input: examInput,
        output: Schema.Boolean,
        run: (input) =>
          db.orm
            .update(projects)
            .set({ exam_on: input.examOn, updated_at: unixSeconds(timestampClock) })
            .where(eq(projects.id, input.id))
            .run().changes !== 0
      })
    }
  };
}
