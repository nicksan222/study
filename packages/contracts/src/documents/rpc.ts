import { Effect, Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

import { failureSchema } from '../errors.ts';
import {
  studyDocumentIdSchema,
  studyDocumentVersionIdSchema,
  sourceIdSchema,
  contentSnapshotIdSchema,
  projectIdSchema,
  sessionIdSchema
} from '../ids.ts';
import * as e from './editing.ts';
import * as evidence from './evidence.ts';
import { exportDocumentInputSchema, documentFileSchema } from './export.ts';
import * as s from './schemas.ts';
import * as t from './transform.ts';
export const documentKeySchema = Schema.Struct({ id: studyDocumentIdSchema });
export const versionKeySchema = Schema.Struct({ id: studyDocumentVersionIdSchema });
const limit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })).pipe(
  Schema.withDecodingDefault(Effect.succeed(30))
);
export const listSchema = Schema.Struct({
  limit,
  cursor: Schema.optional(studyDocumentIdSchema),
  projectId: Schema.optional(projectIdSchema),
  sessionId: Schema.optional(sessionIdSchema),
  archived: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false)))
});
export const versionsSchema = Schema.Struct({
  documentId: studyDocumentIdSchema,
  limit,
  cursor: Schema.optional(studyDocumentVersionIdSchema)
});
export const metadataSchema = Schema.Struct({
  id: studyDocumentIdSchema,
  title: e.createSchema.fields.title,
  description: Schema.NullOr(Schema.Trim.check(Schema.isMaxLength(100000))),
  expectedTitle: e.createSchema.fields.title,
  expectedDescription: Schema.NullOr(Schema.String)
});
export const archiveSchema = Schema.Struct({ id: studyDocumentIdSchema, archived: Schema.Boolean });
export const linkSchema = Schema.Struct({
  documentId: studyDocumentIdSchema,
  sessionId: sessionIdSchema
});
export const projectLinkSchema = Schema.Struct({
  documentId: studyDocumentIdSchema,
  projectId: projectIdSchema
});
export const sourceCopySchema = Schema.Struct({
  createKey: e.keySchema,
  title: e.createSchema.fields.title,
  sourceId: sourceIdSchema,
  revision: Schema.BigInt,
  snapshotId: contentSnapshotIdSchema,
  projectId: Schema.optional(projectIdSchema),
  sessionId: Schema.optional(sessionIdSchema)
});
export const exportSchema = Schema.Struct({
  version: s.versionSchema,
  format: Schema.Literal('canonical_json'),
  content: Schema.String
});
export const historySchema = Schema.Struct({
  documentId: studyDocumentIdSchema,
  keepLatest: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }))
});
export const retirementPreviewSchema = Schema.Struct({
  documentId: studyDocumentIdSchema,
  token: Schema.String,
  versionIds: Schema.Array(studyDocumentVersionIdSchema),
  blockedVersionIds: Schema.Array(studyDocumentVersionIdSchema),
  semantics: Schema.Literal('retire_bodies_retain_identities')
});
export const retireSchema = Schema.Struct({ ...historySchema.fields, token: Schema.String });
export const deleteSchema = Schema.Struct({
  documentId: studyDocumentIdSchema,
  token: Schema.String
});
export const DocumentsRpc = RpcGroup.make(
  Rpc.make('requestTransform', {
    payload: t.transformRequestSchema,
    success: t.transformSnapshotSchema,
    error: failureSchema
  }),
  Rpc.make('transform', {
    payload: t.transformKeySchema,
    success: t.transformSnapshotSchema,
    error: failureSchema
  }),
  Rpc.make('cancelTransform', {
    payload: t.transformKeySchema,
    success: t.transformSnapshotSchema,
    error: failureSchema
  }),
  Rpc.make('retryTransform', {
    payload: Schema.Struct({ ...t.transformKeySchema.fields, retryId: e.keySchema }),
    success: t.transformSnapshotSchema,
    error: failureSchema
  }),
  Rpc.make('updateMetadata', {
    payload: metadataSchema,
    success: s.detailSchema,
    error: failureSchema
  }),
  Rpc.make('compareProposal', {
    payload: e.proposalKeySchema,
    success: e.comparisonSchema,
    error: failureSchema
  }),
  Rpc.make('proposal', {
    payload: e.proposalKeySchema,
    success: e.proposalSchema,
    error: failureSchema
  }),
  Rpc.make('applyProposal', {
    payload: e.applyProposalSchema,
    success: e.proposalOutcomeSchema,
    error: failureSchema
  }),
  Rpc.make('keepProposal', {
    payload: e.keepProposalSchema,
    success: e.proposalOutcomeSchema,
    error: failureSchema
  }),
  Rpc.make('assessCitation', {
    payload: evidence.assessCitationSchema,
    success: evidence.assessmentRecordSchema,
    error: failureSchema
  }),
  Rpc.make('assessments', {
    payload: evidence.assessmentsInputSchema,
    success: evidence.assessmentsPageSchema,
    error: failureSchema
  }),
  Rpc.make('annotations', {
    payload: evidence.annotationsSchema,
    success: evidence.annotationsPageSchema,
    error: failureSchema
  }),
  Rpc.make('annotation', {
    payload: evidence.annotationKeySchema,
    success: evidence.annotationSchema,
    error: failureSchema
  }),
  Rpc.make('annotationHistory', {
    payload: evidence.annotationHistorySchema,
    success: evidence.annotationPageSchema,
    error: failureSchema
  }),
  Rpc.make('createAnnotation', {
    payload: evidence.createAnnotationSchema,
    success: evidence.annotationOutcomeSchema,
    error: failureSchema
  }),
  Rpc.make('reviseAnnotation', {
    payload: evidence.reviseAnnotationSchema,
    success: evidence.annotationOutcomeSchema,
    error: failureSchema
  }),
  Rpc.make('create', { payload: e.createSchema, success: s.detailSchema, error: failureSchema }),
  Rpc.make('document', {
    payload: documentKeySchema,
    success: s.detailSchema,
    error: failureSchema
  }),
  Rpc.make('documents', {
    payload: listSchema,
    success: s.documentPageSchema,
    error: failureSchema
  }),
  Rpc.make('version', {
    payload: versionKeySchema,
    success: s.versionSchema,
    error: failureSchema
  }),
  Rpc.make('versions', {
    payload: versionsSchema,
    success: s.versionPageSchema,
    error: failureSchema
  }),
  Rpc.make('save', { payload: e.saveSchema, success: e.editOutcomeSchema, error: failureSchema }),
  Rpc.make('restore', {
    payload: e.restoreSchema,
    success: e.editOutcomeSchema,
    error: failureSchema
  }),
  Rpc.make('compare', {
    payload: e.compareSchema,
    success: e.comparisonSchema,
    error: failureSchema
  }),
  Rpc.make('copySource', {
    payload: sourceCopySchema,
    success: s.detailSchema,
    error: failureSchema
  }),
  Rpc.make('archive', { payload: archiveSchema, success: s.detailSchema, error: failureSchema }),
  Rpc.make('attachProject', {
    payload: projectLinkSchema,
    success: Schema.Void,
    error: failureSchema
  }),
  Rpc.make('detachProject', {
    payload: projectLinkSchema,
    success: Schema.Void,
    error: failureSchema
  }),
  Rpc.make('attach', { payload: linkSchema, success: Schema.Void, error: failureSchema }),
  Rpc.make('detach', { payload: linkSchema, success: Schema.Void, error: failureSchema }),
  Rpc.make('exportFile', {
    payload: exportDocumentInputSchema,
    success: documentFileSchema,
    error: failureSchema
  }),
  Rpc.make('exportVersion', {
    payload: versionKeySchema,
    success: exportSchema,
    error: failureSchema
  }),
  Rpc.make('previewHistory', {
    payload: historySchema,
    success: retirementPreviewSchema,
    error: failureSchema
  }),
  Rpc.make('retireHistory', {
    payload: retireSchema,
    success: retirementPreviewSchema,
    error: failureSchema
  }),
  Rpc.make('previewDeletion', {
    payload: documentKeySchema,
    success: retirementPreviewSchema,
    error: failureSchema
  }),
  Rpc.make('delete', { payload: deleteSchema, success: Schema.Void, error: failureSchema })
).prefix('documents.');
