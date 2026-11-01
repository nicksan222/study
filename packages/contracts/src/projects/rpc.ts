import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

import { failureSchema } from '../errors.ts';
import { projectIdSchema, materialIdSchema, sessionIdSchema } from '../ids.ts';
import { projectSchema } from './schemas.ts';

export const projectPageInputSchema = Schema.Struct({
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  before: Schema.optional(projectIdSchema)
});

const projectPageSchema = Schema.Struct({
  items: Schema.Array(projectSchema),
  next: Schema.NullOr(projectIdSchema)
});

export const createProjectInputSchema = Schema.Struct({ name: Schema.String });

export const projectIdInputSchema = Schema.Struct({ id: projectIdSchema });

export const renameProjectInputSchema = Schema.Struct({ id: projectIdSchema, name: Schema.String });

export const setExamInputSchema = Schema.Struct({
  id: projectIdSchema,
  examOn: Schema.NullOr(Schema.String)
});

export const projectMaterialInputSchema = Schema.Struct({
  projectId: projectIdSchema,
  materialId: materialIdSchema
});
export const projectSessionInputSchema = Schema.Struct({
  projectId: projectIdSchema,
  sessionId: sessionIdSchema
});

export const ProjectsRpc = RpcGroup.make(
  Rpc.make('addMaterial', {
    payload: projectMaterialInputSchema,
    success: Schema.Void,
    error: failureSchema
  }),
  Rpc.make('removeMaterial', {
    payload: projectMaterialInputSchema,
    success: Schema.Void,
    error: failureSchema
  }),
  Rpc.make('addSession', {
    payload: projectSessionInputSchema,
    success: Schema.Void,
    error: failureSchema
  }),
  Rpc.make('removeSession', {
    payload: projectSessionInputSchema,
    success: Schema.Void,
    error: failureSchema
  }),
  Rpc.make('project', {
    payload: projectIdInputSchema,
    success: projectSchema,
    error: failureSchema
  }),
  Rpc.make('findProject', {
    payload: projectIdInputSchema,
    success: Schema.Option(projectSchema),
    error: failureSchema
  }),
  Rpc.make('projects', {
    payload: projectPageInputSchema,
    success: projectPageSchema,
    error: failureSchema
  }),
  Rpc.make('createProject', {
    payload: createProjectInputSchema,
    success: projectSchema,
    error: failureSchema
  }),
  Rpc.make('renameProject', {
    payload: renameProjectInputSchema,
    success: Schema.Boolean,
    error: failureSchema
  }),
  Rpc.make('deleteProject', {
    payload: projectIdInputSchema,
    success: Schema.Boolean,
    error: failureSchema
  }),
  Rpc.make('setExam', {
    payload: setExamInputSchema,
    success: Schema.Boolean,
    error: failureSchema
  })
).prefix('projects.');
