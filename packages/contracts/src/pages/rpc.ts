import { Effect, Schema } from 'effect';

import { failureSchema } from '../errors.ts';
import {
  pageIdSchema,
  pageVersionIdSchema,
  sourceIdSchema,
  contentSnapshotIdSchema,
  projectIdSchema,
  noteIdSchema
} from '../ids.ts';
import { allDependencies, dependency, endpointGroup, liveQuery, mutation } from '../protocol.ts';
import * as e from './editing.ts';
import * as evidence from './evidence.ts';
import { exportPageInputSchema, pageFileSchema } from './export.ts';
import * as s from './schemas.ts';
import * as t from './transform.ts';

export const pageKeySchema = Schema.Struct({
  id: pageIdSchema,
  noteId: Schema.optional(noteIdSchema)
});

export const versionKeySchema = Schema.Struct({ id: pageVersionIdSchema });

const limit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })).pipe(
  Schema.withDecodingDefault(Effect.succeed(30))
);

export const listSchema = Schema.Struct({
  limit,
  cursor: Schema.optional(pageIdSchema),
  projectId: Schema.optional(projectIdSchema),
  noteId: Schema.optional(noteIdSchema),
  archived: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false)))
});

export const versionsSchema = Schema.Struct({
  pageId: pageIdSchema,
  limit,
  cursor: Schema.optional(pageVersionIdSchema)
});

export const metadataSchema = Schema.Struct({
  id: pageIdSchema,
  title: e.createSchema.fields.title,
  description: Schema.NullOr(Schema.Trim.check(Schema.isMaxLength(100000))),
  expectedTitle: e.createSchema.fields.title,
  expectedDescription: Schema.NullOr(Schema.String)
});

export const archiveSchema = Schema.Struct({ id: pageIdSchema, archived: Schema.Boolean });

export const linkSchema = Schema.Struct({
  pageId: pageIdSchema,
  noteId: noteIdSchema
});

export const projectLinkSchema = Schema.Struct({
  pageId: pageIdSchema,
  projectId: projectIdSchema
});

export const sourceCopySchema = Schema.Struct({
  createKey: e.keySchema,
  title: e.createSchema.fields.title,
  sourceId: sourceIdSchema,
  revision: Schema.BigInt,
  snapshotId: contentSnapshotIdSchema,
  projectId: Schema.optional(projectIdSchema),
  noteId: Schema.optional(noteIdSchema)
});

export const exportSchema = Schema.Struct({
  version: s.versionSchema,
  format: Schema.Literal('canonical_json'),
  content: Schema.String
});

export const historySchema = Schema.Struct({
  pageId: pageIdSchema,
  versionId: Schema.optional(pageVersionIdSchema),
  keepLatest: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }))
});

export const retirementPreviewSchema = Schema.Struct({
  pageId: pageIdSchema,
  token: Schema.String,
  versionIds: Schema.Array(pageVersionIdSchema),
  blockedVersionIds: Schema.Array(pageVersionIdSchema),
  semantics: Schema.Literal('retire_bodies_retain_identities')
});

export const retireSchema = Schema.Struct({ ...historySchema.fields, token: Schema.String });

export const deleteSchema = Schema.Struct({
  pageId: pageIdSchema,
  token: Schema.String
});

export const countInputSchema = Schema.Struct({
  projectId: listSchema.fields.projectId,
  noteId: listSchema.fields.noteId,
  archived: listSchema.fields.archived
});

export const pagesEndpoints = {
  count: liveQuery(
    'pages.count',
    { payload: countInputSchema, success: Schema.BigInt, error: failureSchema },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  merges: liveQuery(
    'pages.merges',
    {
      payload: Schema.Struct({ projectId: Schema.optional(projectIdSchema) }),
      success: Schema.Array(t.transformSnapshotSchema),
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  merge: mutation(
    'pages.merge',
    {
      payload: t.mergeRequestSchema,
      success: t.transformSnapshotSchema,
      error: failureSchema
    },
    { changes: [dependency.pages] }
  ),
  requestTransform: mutation(
    'pages.requestTransform',
    {
      payload: t.transformRequestSchema,
      success: t.transformSnapshotSchema,
      error: failureSchema
    },
    { changes: [dependency.pages] }
  ),
  transform: liveQuery(
    'pages.transform',
    {
      payload: t.transformKeySchema,
      success: t.transformSnapshotSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  cancelTransform: mutation(
    'pages.cancelTransform',
    {
      payload: t.transformKeySchema,
      success: t.transformSnapshotSchema,
      error: failureSchema
    },
    { changes: [dependency.pages] }
  ),
  retryTransform: mutation(
    'pages.retryTransform',
    {
      payload: Schema.Struct({ ...t.transformKeySchema.fields, retryId: e.keySchema }),
      success: t.transformSnapshotSchema,
      error: failureSchema
    },
    { changes: [dependency.pages] }
  ),
  updateMetadata: mutation(
    'pages.updateMetadata',
    {
      payload: metadataSchema,
      success: s.detailSchema,
      error: failureSchema
    },
    { changes: [dependency.pages] }
  ),
  compareProposal: liveQuery(
    'pages.compareProposal',
    {
      payload: e.proposalKeySchema,
      success: e.comparisonSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  proposal: liveQuery(
    'pages.proposal',
    {
      payload: e.proposalKeySchema,
      success: e.proposalSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  applyProposal: mutation(
    'pages.applyProposal',
    {
      payload: e.applyProposalSchema,
      success: e.proposalOutcomeSchema,
      error: failureSchema
    },
    { changes: [dependency.pages] }
  ),
  keepProposal: mutation(
    'pages.keepProposal',
    {
      payload: e.keepProposalSchema,
      success: e.proposalOutcomeSchema,
      error: failureSchema
    },
    { changes: [dependency.pages] }
  ),
  assessCitation: mutation(
    'pages.assessCitation',
    {
      payload: evidence.assessCitationSchema,
      success: evidence.assessmentRecordSchema,
      error: failureSchema
    },
    { changes: [dependency.pages] }
  ),
  assessments: liveQuery(
    'pages.assessments',
    {
      payload: evidence.assessmentsInputSchema,
      success: evidence.assessmentsPageSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  annotations: liveQuery(
    'pages.annotations',
    {
      payload: evidence.annotationsSchema,
      success: evidence.annotationsPageSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  annotation: liveQuery(
    'pages.annotation',
    {
      payload: evidence.annotationKeySchema,
      success: evidence.annotationSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  annotationHistory: liveQuery(
    'pages.annotationHistory',
    {
      payload: evidence.annotationHistorySchema,
      success: evidence.annotationPageSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  createAnnotation: mutation(
    'pages.createAnnotation',
    {
      payload: evidence.createAnnotationSchema,
      success: evidence.annotationOutcomeSchema,
      error: failureSchema
    },
    { changes: [dependency.pages] }
  ),
  reviseAnnotation: mutation(
    'pages.reviseAnnotation',
    {
      payload: evidence.reviseAnnotationSchema,
      success: evidence.annotationOutcomeSchema,
      error: failureSchema
    },
    { changes: [dependency.pages] }
  ),
  create: mutation(
    'pages.create',
    { payload: e.createSchema, success: s.detailSchema, error: failureSchema },
    { changes: [dependency.pages] }
  ),
  get: liveQuery(
    'pages.page',
    {
      payload: pageKeySchema,
      success: s.detailSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  list: liveQuery(
    'pages.pages',
    {
      payload: listSchema,
      success: s.pageListSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  version: liveQuery(
    'pages.version',
    {
      payload: versionKeySchema,
      success: s.versionSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  versions: liveQuery(
    'pages.versions',
    {
      payload: versionsSchema,
      success: s.versionPageSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  save: mutation(
    'pages.save',
    { payload: e.saveSchema, success: e.editOutcomeSchema, error: failureSchema },
    { changes: [dependency.pages] }
  ),
  restore: mutation(
    'pages.restore',
    {
      payload: e.restoreSchema,
      success: e.editOutcomeSchema,
      error: failureSchema
    },
    { changes: [dependency.pages] }
  ),
  compare: liveQuery(
    'pages.compare',
    {
      payload: e.compareSchema,
      success: e.comparisonSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  copySource: mutation(
    'pages.copySource',
    {
      payload: sourceCopySchema,
      success: s.detailSchema,
      error: failureSchema
    },
    { changes: [dependency.pages] }
  ),
  archive: mutation(
    'pages.archive',
    { payload: archiveSchema, success: s.detailSchema, error: failureSchema },
    { changes: [dependency.pages] }
  ),
  attachProject: mutation(
    'pages.attachProject',
    {
      payload: projectLinkSchema,
      success: Schema.Void,
      error: failureSchema
    },
    { changes: [dependency.pages] }
  ),
  detachProject: mutation(
    'pages.detachProject',
    {
      payload: projectLinkSchema,
      success: Schema.Void,
      error: failureSchema
    },
    { changes: [dependency.pages] }
  ),
  attach: mutation(
    'pages.attach',
    { payload: linkSchema, success: Schema.Void, error: failureSchema },
    { changes: [dependency.pages] }
  ),
  detach: mutation(
    'pages.detach',
    { payload: linkSchema, success: Schema.Void, error: failureSchema },
    { changes: [dependency.pages] }
  ),
  exportFile: liveQuery(
    'pages.exportFile',
    {
      payload: exportPageInputSchema,
      success: pageFileSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  exportVersion: liveQuery(
    'pages.exportVersion',
    {
      payload: versionKeySchema,
      success: exportSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  previewHistory: liveQuery(
    'pages.previewHistory',
    {
      payload: historySchema,
      success: retirementPreviewSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  retireHistory: mutation(
    'pages.retireHistory',
    {
      payload: retireSchema,
      success: retirementPreviewSchema,
      error: failureSchema
    },
    { changes: [dependency.pages] }
  ),
  previewDeletion: liveQuery(
    'pages.previewDeletion',
    {
      payload: pageKeySchema,
      success: retirementPreviewSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  delete: mutation(
    'pages.delete',
    { payload: deleteSchema, success: Schema.Void, error: failureSchema },
    { changes: [dependency.pages] }
  )
};

export const PagesRpc = endpointGroup(pagesEndpoints);
