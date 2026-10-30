import { Effect, Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

import { failureSchema } from '../errors.ts';
import {
  materialIdSchema,
  materialVersionIdSchema,
  projectIdSchema,
  sessionIdSchema
} from '../ids.ts';
import { sourceExportSchema } from '../sources/rpc.ts';
import {
  materialGenerationInputSchema,
  materialGenerationSchema,
  createMaterialInputSchema,
  createMaterialVersionInputSchema,
  materialDetailSchema,
  materialVersionDetailSchema,
  materialSummarySchema,
  materialVersionSummarySchema,
  materialCitationSchema
} from './schemas.ts';

const limit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })).pipe(
  Schema.withDecodingDefault(Effect.succeed(30))
);

const materialKey = Schema.Struct({ id: materialIdSchema });

const versionKey = Schema.Struct({ id: materialVersionIdSchema });

const versionPageFields = { limit, cursor: Schema.optional(materialVersionIdSchema) };

export const createInputSchema = createMaterialInputSchema;

export const createVersionInputSchema = Schema.Struct({
  ...createMaterialVersionInputSchema.fields,
  materialId: materialIdSchema
});

export const materialInputSchema = materialKey;

export const materialVersionInputSchema = versionKey;

export const archiveInputSchema = materialKey;

export const unarchiveInputSchema = materialKey;

export const deleteDraftInputSchema = versionKey;

export const publishVersionInputSchema = versionKey;

export const materialsInputSchema = Schema.Struct({
  limit,
  cursor: Schema.optional(materialIdSchema),
  projectId: projectIdSchema,
  sessionId: Schema.optional(sessionIdSchema),
  archived: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false)))
});

export const materialVersionsInputSchema = Schema.Struct({
  ...versionPageFields,
  materialId: materialIdSchema
});

export const inputsInputSchema = Schema.Struct({
  ...versionPageFields,
  id: materialVersionIdSchema
});

export const dependentsInputSchema = inputsInputSchema;

export const citationsInputSchema = Schema.Struct({
  id: materialVersionIdSchema,
  limit,
  cursor: Schema.optional(materialCitationSchema.fields.marker)
});

export const attachInputSchema = Schema.Struct({
  sessionId: sessionIdSchema,
  materialId: materialIdSchema
});

export const detachInputSchema = attachInputSchema;

export const renameInputSchema = Schema.Struct({
  id: materialIdSchema,
  title: Schema.Trim.check(Schema.isBetweenLength(1, 200))
});

export const reorderInputSchema = Schema.Struct({
  sessionId: sessionIdSchema,
  materialIds: Schema.mutable(Schema.Array(materialIdSchema)).check(Schema.isMaxLength(10000))
});

export const replaceDraftInputSchema = Schema.Struct({
  ...createMaterialVersionInputSchema.fields,
  id: materialVersionIdSchema,
  publish: Schema.optional(Schema.Never)
});

export const setCitationsInputSchema = Schema.Struct({
  id: materialVersionIdSchema,
  citations: Schema.mutable(Schema.Array(materialCitationSchema)).check(Schema.isMaxLength(10000))
});

export const materialPageSchema = Schema.Struct({
  items: Schema.Array(materialSummarySchema),
  nextCursor: Schema.NullOr(materialIdSchema)
});

export const versionPageSchema = Schema.Struct({
  items: Schema.Array(materialVersionSummarySchema),
  nextCursor: Schema.NullOr(materialVersionIdSchema)
});

export const citationPageSchema = Schema.Struct({
  items: Schema.Array(materialCitationSchema),
  nextCursor: Schema.NullOr(materialCitationSchema.fields.marker)
});

const linked = attachInputSchema;

export const requestMaterialGenerationInputSchema = materialGenerationInputSchema;

export const MaterialsRpc = RpcGroup.make(
  Rpc.make('requestMaterialGeneration', {
    payload: requestMaterialGenerationInputSchema,
    success: materialGenerationSchema,
    error: failureSchema
  }),
  Rpc.make('archive', {
    payload: archiveInputSchema,
    success: materialDetailSchema,
    error: failureSchema
  }),
  Rpc.make('unarchive', {
    payload: unarchiveInputSchema,
    success: materialDetailSchema,
    error: failureSchema
  }),
  Rpc.make('create', {
    payload: createInputSchema,
    success: materialDetailSchema,
    error: failureSchema
  }),
  Rpc.make('createVersion', {
    payload: createVersionInputSchema,
    success: materialVersionDetailSchema,
    error: failureSchema
  }),
  Rpc.make('material', {
    payload: materialInputSchema,
    success: materialDetailSchema,
    error: failureSchema
  }),
  Rpc.make('materialVersion', {
    payload: materialVersionInputSchema,
    success: materialVersionDetailSchema,
    error: failureSchema
  }),
  Rpc.make('materialVersionExport', {
    payload: materialVersionInputSchema,
    success: sourceExportSchema,
    error: failureSchema
  }),
  Rpc.make('materials', {
    payload: materialsInputSchema,
    success: materialPageSchema,
    error: failureSchema
  }),
  Rpc.make('materialVersions', {
    payload: materialVersionsInputSchema,
    success: versionPageSchema,
    error: failureSchema
  }),
  Rpc.make('inputs', {
    payload: inputsInputSchema,
    success: versionPageSchema,
    error: failureSchema
  }),
  Rpc.make('dependents', {
    payload: dependentsInputSchema,
    success: versionPageSchema,
    error: failureSchema
  }),
  Rpc.make('citations', {
    payload: citationsInputSchema,
    success: citationPageSchema,
    error: failureSchema
  }),
  Rpc.make('attach', { payload: attachInputSchema, success: linked, error: failureSchema }),
  Rpc.make('detach', { payload: detachInputSchema, success: linked, error: failureSchema }),
  Rpc.make('rename', {
    payload: renameInputSchema,
    success: materialDetailSchema,
    error: failureSchema
  }),
  Rpc.make('reorder', {
    payload: reorderInputSchema,
    success: Schema.Struct({ materialIds: Schema.Array(materialIdSchema) }),
    error: failureSchema
  }),
  Rpc.make('replaceDraft', {
    payload: replaceDraftInputSchema,
    success: materialVersionDetailSchema,
    error: failureSchema
  }),
  Rpc.make('deleteDraft', {
    payload: deleteDraftInputSchema,
    success: versionKey,
    error: failureSchema
  }),
  Rpc.make('publishVersion', {
    payload: publishVersionInputSchema,
    success: materialVersionDetailSchema,
    error: failureSchema
  }),
  Rpc.make('setCitations', {
    payload: setCitationsInputSchema,
    success: Schema.Array(materialCitationSchema),
    error: failureSchema
  })
).prefix('materials.');
