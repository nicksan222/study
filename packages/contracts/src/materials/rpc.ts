import { Effect, Schema } from 'effect';

import { failureSchema } from '../errors.ts';
import {
  contentSnapshotIdSchema,
  materialIdSchema,
  materialVersionIdSchema,
  projectIdSchema,
  noteIdSchema
} from '../ids.ts';
import { allDependencies, dependency, endpointGroup, liveQuery, mutation } from '../protocol.ts';
import { blockIdSchema } from '../sources/schemas.ts';
import {
  materialDeletionKeySchema,
  materialDeletionPreviewSchema,
  requestMaterialDeletionSchema,
  materialDeletionSchema
} from './deletion.ts';
import { exportMaterialVersionInputSchema, materialVersionFileSchema } from './export.ts';
import * as history from './history.ts';
import {
  materialGenerationSnapshotSchema,
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

/** Exact retained Document block ownership; no current Source lookup is implied. */
export const materialVersionImageInputSchema = Schema.Struct({
  id: materialVersionIdSchema,
  documentId: contentSnapshotIdSchema,
  blockId: blockIdSchema
});

export const archiveInputSchema = materialKey;

export const unarchiveInputSchema = materialKey;

export const deleteDraftInputSchema = versionKey;

export const publishVersionInputSchema = versionKey;

export const materialsInputSchema = Schema.Struct({
  limit,
  cursor: Schema.optional(materialIdSchema),
  projectId: Schema.optional(projectIdSchema),
  noteId: Schema.optional(noteIdSchema),
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
  noteId: noteIdSchema,
  materialId: materialIdSchema
});

export const detachInputSchema = attachInputSchema;

export const renameInputSchema = Schema.Struct({
  id: materialIdSchema,
  title: Schema.Trim.check(Schema.isBetweenLength(1, 200))
});

export const updateDescriptionInputSchema = Schema.Struct({
  id: materialIdSchema,
  description: Schema.NullOr(Schema.String.check(Schema.isMaxLength(240))),
  expectedDescription: Schema.NullOr(Schema.String.check(Schema.isMaxLength(240)))
});

export const reorderInputSchema = Schema.Struct({
  noteId: noteIdSchema,
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

const generationKeySchema = Schema.Struct({
  requestId: Schema.String.check(Schema.isMinLength(1))
});

const retryGenerationSchema = Schema.Struct({
  ...generationKeySchema.fields,
  retryId: Schema.String.check(Schema.isMinLength(1))
});

export const countInputSchema = Schema.Struct({
  projectId: materialsInputSchema.fields.projectId,
  noteId: materialsInputSchema.fields.noteId,
  archived: materialsInputSchema.fields.archived
});

export const materialsEndpoints = {
  count: liveQuery(
    'materials.count',
    { payload: countInputSchema, success: Schema.BigInt, error: failureSchema },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  exportMaterialVersion: liveQuery(
    'materials.exportMaterialVersion',
    {
      payload: exportMaterialVersionInputSchema,
      success: materialVersionFileSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  previewHistoryPrune: liveQuery(
    'materials.previewHistoryPrune',
    {
      payload: history.historyScopeSchema,
      success: history.historyPreviewSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  requestHistoryPrune: mutation(
    'materials.requestHistoryPrune',
    {
      payload: history.requestHistoryPruneSchema,
      success: history.historyPruneSchema,
      error: failureSchema
    },
    { changes: [dependency.materials] }
  ),
  historyPrune: liveQuery(
    'materials.historyPrune',
    {
      payload: history.historyOperationKeySchema,
      success: history.historyPruneSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  retryHistoryPrune: mutation(
    'materials.retryHistoryPrune',
    {
      payload: history.historyOperationKeySchema,
      success: history.historyPruneSchema,
      error: failureSchema
    },
    { changes: [dependency.materials] }
  ),
  previewDeletion: liveQuery(
    'materials.previewDeletion',
    {
      payload: materialDeletionKeySchema,
      success: materialDeletionPreviewSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  requestDeletion: mutation(
    'materials.requestDeletion',
    {
      payload: requestMaterialDeletionSchema,
      success: materialDeletionSchema,
      error: failureSchema
    },
    { changes: [dependency.materials] }
  ),
  deletion: liveQuery(
    'materials.deletion',
    {
      payload: materialDeletionKeySchema,
      success: materialDeletionSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  retryDeletion: mutation(
    'materials.retryDeletion',
    {
      payload: materialDeletionKeySchema,
      success: materialDeletionSchema,
      error: failureSchema
    },
    { changes: [dependency.materials] }
  ),
  activeMaterialGenerations: liveQuery(
    'materials.activeMaterialGenerations',
    {
      payload: Schema.Struct({ projectId: Schema.optional(projectIdSchema) }),
      success: Schema.Array(materialGenerationSnapshotSchema),
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  materialGeneration: liveQuery(
    'materials.materialGeneration',
    {
      payload: generationKeySchema,
      success: materialGenerationSnapshotSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  cancelMaterialGeneration: mutation(
    'materials.cancelMaterialGeneration',
    {
      payload: generationKeySchema,
      success: materialGenerationSnapshotSchema,
      error: failureSchema
    },
    { changes: [dependency.materials] }
  ),
  retryMaterialGeneration: mutation(
    'materials.retryMaterialGeneration',
    {
      payload: retryGenerationSchema,
      success: materialGenerationSnapshotSchema,
      error: failureSchema
    },
    { changes: [dependency.materials] }
  ),
  requestMaterialGeneration: mutation(
    'materials.requestMaterialGeneration',
    {
      payload: requestMaterialGenerationInputSchema,
      success: materialGenerationSchema,
      error: failureSchema
    },
    { changes: [dependency.materials] }
  ),
  archive: mutation(
    'materials.archive',
    {
      payload: archiveInputSchema,
      success: materialDetailSchema,
      error: failureSchema
    },
    { changes: [dependency.materials] }
  ),
  unarchive: mutation(
    'materials.unarchive',
    {
      payload: unarchiveInputSchema,
      success: materialDetailSchema,
      error: failureSchema
    },
    { changes: [dependency.materials] }
  ),
  create: mutation(
    'materials.create',
    {
      payload: createInputSchema,
      success: materialDetailSchema,
      error: failureSchema
    },
    { changes: [dependency.materials] }
  ),
  createVersion: mutation(
    'materials.createVersion',
    {
      payload: createVersionInputSchema,
      success: materialVersionDetailSchema,
      error: failureSchema
    },
    { changes: [dependency.materials] }
  ),
  get: liveQuery(
    'materials.material',
    {
      payload: materialInputSchema,
      success: materialDetailSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  version: liveQuery(
    'materials.materialVersion',
    {
      payload: materialVersionInputSchema,
      success: materialVersionDetailSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  list: liveQuery(
    'materials.materials',
    {
      payload: materialsInputSchema,
      success: materialPageSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  versions: liveQuery(
    'materials.materialVersions',
    {
      payload: materialVersionsInputSchema,
      success: versionPageSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  citations: liveQuery(
    'materials.citations',
    {
      payload: citationsInputSchema,
      success: citationPageSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  attach: mutation(
    'materials.attach',
    { payload: attachInputSchema, success: linked, error: failureSchema },
    { changes: [dependency.materials] }
  ),
  detach: mutation(
    'materials.detach',
    { payload: detachInputSchema, success: linked, error: failureSchema },
    { changes: [dependency.materials] }
  ),
  updateDescription: mutation(
    'materials.updateDescription',
    {
      payload: updateDescriptionInputSchema,
      success: materialDetailSchema,
      error: failureSchema
    },
    { changes: [dependency.materials] }
  ),
  rename: mutation(
    'materials.rename',
    {
      payload: renameInputSchema,
      success: materialDetailSchema,
      error: failureSchema
    },
    { changes: [dependency.materials] }
  ),
  reorder: mutation(
    'materials.reorder',
    {
      payload: reorderInputSchema,
      success: Schema.Struct({ materialIds: Schema.Array(materialIdSchema) }),
      error: failureSchema
    },
    { changes: [dependency.materials] }
  ),
  replaceDraft: mutation(
    'materials.replaceDraft',
    {
      payload: replaceDraftInputSchema,
      success: materialVersionDetailSchema,
      error: failureSchema
    },
    { changes: [dependency.materials] }
  ),
  deleteDraft: mutation(
    'materials.deleteDraft',
    {
      payload: deleteDraftInputSchema,
      success: versionKey,
      error: failureSchema
    },
    { changes: [dependency.materials] }
  ),
  publishVersion: mutation(
    'materials.publishVersion',
    {
      payload: publishVersionInputSchema,
      success: materialVersionDetailSchema,
      error: failureSchema
    },
    { changes: [dependency.materials] }
  ),
  setCitations: mutation(
    'materials.setCitations',
    {
      payload: setCitationsInputSchema,
      success: Schema.Array(materialCitationSchema),
      error: failureSchema
    },
    { changes: [dependency.materials] }
  )
};

export const MaterialsRpc = endpointGroup(materialsEndpoints);
