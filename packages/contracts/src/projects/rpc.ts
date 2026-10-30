import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

import { failureSchema } from '../errors.ts';
import { projectIdSchema } from '../ids.ts';
import { projectSchema } from './schemas.ts';

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

export const setExamInputSchema = Schema.Struct({
  id: projectIdSchema,
  examOn: Schema.NullOr(Schema.String)
});

export const ProjectsRpc = RpcGroup.make(
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
