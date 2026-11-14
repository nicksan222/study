import { Schema } from 'effect';

import { failureSchema } from '../errors.ts';
import { projectIdSchema, materialIdSchema, noteIdSchema } from '../ids.ts';
import { allDependencies, dependency, endpointGroup, liveQuery, mutation } from '../protocol.ts';
import { projectSchema, projectIconSchema } from './schemas.ts';

export const projectPageInputSchema = Schema.Struct({
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  before: Schema.optional(projectIdSchema)
});

export const projectPageSchema = Schema.Struct({
  items: Schema.Array(projectSchema),
  next: Schema.NullOr(projectIdSchema)
});

export const createProjectInputSchema = Schema.Struct({ name: Schema.String });

export const projectIdInputSchema = Schema.Struct({ id: projectIdSchema });

export const renameProjectInputSchema = Schema.Struct({ id: projectIdSchema, name: Schema.String });

export const setProjectIconInputSchema = Schema.Struct({
  id: projectIdSchema,
  icon: projectIconSchema
});

export const setExamInputSchema = Schema.Struct({
  id: projectIdSchema,
  examOn: Schema.NullOr(Schema.String)
});

export const projectMaterialInputSchema = Schema.Struct({
  projectId: projectIdSchema,
  materialId: materialIdSchema
});

export const projectNoteInputSchema = Schema.Struct({
  projectId: projectIdSchema,
  noteId: noteIdSchema
});

export const projectsEndpoints = {
  addMaterial: mutation(
    'projects.addMaterial',
    {
      payload: projectMaterialInputSchema,
      success: Schema.Void,
      error: failureSchema
    },
    { changes: [dependency.projects] }
  ),
  removeMaterial: mutation(
    'projects.removeMaterial',
    {
      payload: projectMaterialInputSchema,
      success: Schema.Void,
      error: failureSchema
    },
    { changes: [dependency.projects] }
  ),
  addNote: mutation(
    'projects.addNote',
    {
      payload: projectNoteInputSchema,
      success: Schema.Void,
      error: failureSchema
    },
    { changes: [dependency.projects] }
  ),
  removeNote: mutation(
    'projects.removeNote',
    {
      payload: projectNoteInputSchema,
      success: Schema.Void,
      error: failureSchema
    },
    { changes: [dependency.projects] }
  ),
  get: liveQuery(
    'projects.project',
    {
      payload: projectIdInputSchema,
      success: projectSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  find: liveQuery(
    'projects.findProject',
    {
      payload: projectIdInputSchema,
      success: Schema.Option(projectSchema),
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  list: liveQuery(
    'projects.projects',
    {
      payload: projectPageInputSchema,
      success: projectPageSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  create: mutation(
    'projects.createProject',
    {
      payload: createProjectInputSchema,
      success: projectSchema,
      error: failureSchema
    },
    { changes: [dependency.projects] }
  ),
  rename: mutation(
    'projects.renameProject',
    {
      payload: renameProjectInputSchema,
      success: Schema.Boolean,
      error: failureSchema
    },
    { changes: [dependency.projects] }
  ),
  delete: mutation(
    'projects.deleteProject',
    {
      payload: projectIdInputSchema,
      success: Schema.Boolean,
      error: failureSchema
    },
    { changes: [dependency.projects] }
  ),
  setIcon: mutation(
    'projects.setIcon',
    {
      payload: setProjectIconInputSchema,
      success: projectSchema,
      error: failureSchema
    },
    { changes: [dependency.projects] }
  ),
  setExam: mutation(
    'projects.setExam',
    {
      payload: setExamInputSchema,
      success: Schema.Boolean,
      error: failureSchema
    },
    { changes: [dependency.projects] }
  )
};

export const ProjectsRpc = endpointGroup(projectsEndpoints);
