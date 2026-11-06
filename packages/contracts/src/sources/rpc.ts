import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

import { failureSchema } from '../errors.ts';
import {
  contentSnapshotIdSchema,
  projectIdSchema,
  sourceIdSchema,
  sessionIdSchema
} from '../ids.ts';
import { importCapabilityInputSchema, importCapabilitySchema } from './capabilities.ts';
import { conversionStrategySchema } from './conversion.ts';
import { documentSchema, sourceSchema } from './schemas.ts';

export const sourceExportSchema = Schema.Struct({ source: sourceSchema, bytes: Schema.Uint8Array });

export const sourceDeletionPreviewSchema = Schema.Struct({
  sourceId: sourceIdSchema,
  name: Schema.String,
  revisionCount: Schema.BigInt,
  extractionCount: Schema.BigInt,
  blockedBy: Schema.Array(Schema.Literals(['exact_inputs', 'image_assets'])),
  retainedCopies: Schema.Literal('authored_outputs_and_raw_session_records')
});

export const sourceRevisionSchema = Schema.Int.check(Schema.isGreaterThan(0));

/** Processing identity is separate from immutable source metadata. */
export const sourceProcessingSchema = Schema.Struct({
  sourceId: sourceIdSchema,
  revision: sourceRevisionSchema,
  requestId: Schema.NullOr(Schema.String.check(Schema.isMinLength(1))),
  documentId: Schema.NullOr(contentSnapshotIdSchema)
});

export const setSourceProjectInputSchema = Schema.Struct({
  id: sourceIdSchema,
  projectId: Schema.NullOr(projectIdSchema)
});

export const correctBlockInputSchema = Schema.Struct({
  id: sourceIdSchema,
  documentId: contentSnapshotIdSchema,
  ordinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  before: Schema.String,
  after: Schema.String
});

export const sourcePageInputSchema = Schema.Struct({
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  before: Schema.optional(sourceIdSchema)
});

const sourcePageSchema = Schema.Struct({
  items: Schema.Array(sourceSchema),
  next: Schema.NullOr(sourceIdSchema)
});

export const exactExtractionInputSchema = Schema.Struct({
  sourceId: sourceIdSchema,
  revision: Schema.BigInt.check(Schema.isGreaterThanBigInt(0n)),
  snapshotId: contentSnapshotIdSchema
});

const extractionCursorSchema = Schema.Struct({
  revision: Schema.BigInt,
  snapshotId: contentSnapshotIdSchema
});

export const extractionHistoryInputSchema = Schema.Struct({
  sourceId: sourceIdSchema,
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  before: Schema.optional(extractionCursorSchema)
});

const extractionIdentitySchema = Schema.Struct({
  ...exactExtractionInputSchema.fields,
  createdAt: Schema.BigInt
});

export const extractionPageSchema = Schema.Struct({
  items: Schema.Array(extractionIdentitySchema),
  next: Schema.NullOr(extractionCursorSchema)
});

export const revisionExportInputSchema = Schema.Struct({
  sourceId: sourceIdSchema,
  revision: exactExtractionInputSchema.fields.revision
});

export const revisionExportSchema = Schema.Struct({
  ...revisionExportInputSchema.fields,
  name: Schema.String,
  mime: Schema.String,
  bytes: Schema.Uint8Array
});

export const currentExtractionInputSchema = Schema.Struct({ id: sourceIdSchema });

export const exactExtractionSchema = Schema.Struct({
  ...exactExtractionInputSchema.fields,
  name: Schema.String,
  document: documentSchema
});

export const sessionSourcesInputSchema = Schema.Struct({
  sessionId: sessionIdSchema,
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
  afterPosition: Schema.optional(Schema.BigInt.check(Schema.isGreaterThanOrEqualToBigInt(0n)))
});

export const sourceLinkSchema = Schema.Struct({
  sessionId: sessionIdSchema,
  sourceId: sourceIdSchema
});

export const sessionSourceSchema = Schema.Struct({
  id: sourceIdSchema,
  position: Schema.BigInt,
  name: Schema.String,
  kind: sourceSchema.fields.kind,
  revision: Schema.BigInt,
  snapshotId: Schema.NullOr(contentSnapshotIdSchema),
  pending: Schema.Boolean
});

export const sourceHistoryInputSchema = Schema.Struct({
  sourceId: sourceIdSchema,
  snapshotId: Schema.optional(contentSnapshotIdSchema),
  keepLatest: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
});

export const sourceHistoryPreviewSchema = Schema.Struct({
  ...sourceHistoryInputSchema.fields,
  name: Schema.String,
  token: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  candidates: Schema.Array(extractionIdentitySchema),
  blockedSnapshotIds: Schema.Array(contentSnapshotIdSchema),
  semantics: Schema.Literal('retire_extractions_keep_original_revisions')
});

export const sourceHistoryRetireSchema = Schema.Struct({
  ...sourceHistoryInputSchema.fields,
  token: sourceHistoryPreviewSchema.fields.token
});

export const SourcesRpc = RpcGroup.make(
  Rpc.make('conversionStrategies', {
    payload: Schema.Struct({}),
    success: Schema.Array(conversionStrategySchema),
    error: failureSchema
  }),
  Rpc.make('previewHistory', {
    payload: sourceHistoryInputSchema,
    success: sourceHistoryPreviewSchema,
    error: failureSchema
  }),
  Rpc.make('retireHistory', {
    payload: sourceHistoryRetireSchema,
    success: sourceHistoryPreviewSchema,
    error: failureSchema
  }),
  Rpc.make('extractions', {
    payload: extractionHistoryInputSchema,
    success: extractionPageSchema,
    error: failureSchema
  }),
  Rpc.make('exportRevision', {
    payload: revisionExportInputSchema,
    success: revisionExportSchema,
    error: failureSchema
  }),
  Rpc.make('currentExtraction', {
    payload: currentExtractionInputSchema,
    success: Schema.NullOr(exactExtractionSchema),
    error: failureSchema
  }),
  Rpc.make('extraction', {
    payload: exactExtractionInputSchema,
    success: exactExtractionSchema,
    error: failureSchema
  }),
  Rpc.make('sessionSources', {
    payload: sessionSourcesInputSchema,
    success: Schema.Array(sessionSourceSchema),
    error: failureSchema
  }),
  Rpc.make('attachSource', {
    payload: sourceLinkSchema,
    success: Schema.Void,
    error: failureSchema
  }),
  Rpc.make('detachSource', {
    payload: sourceLinkSchema,
    success: Schema.Void,
    error: failureSchema
  }),
  Rpc.make('importCapability', {
    payload: importCapabilityInputSchema,
    success: importCapabilitySchema,
    error: failureSchema
  }),
  Rpc.make('source', {
    payload: { id: sourceIdSchema },
    success: sourceSchema,
    error: failureSchema
  }),
  Rpc.make('sourceExport', {
    payload: { id: sourceIdSchema },
    success: sourceExportSchema,
    error: failureSchema
  }),
  Rpc.make('findSource', {
    payload: { id: sourceIdSchema },
    success: Schema.Option(sourceSchema),
    error: failureSchema
  }),
  Rpc.make('sources', {
    payload: sourcePageInputSchema,
    success: sourcePageSchema,
    error: failureSchema
  }),
  Rpc.make('sourceProcessing', {
    payload: { id: sourceIdSchema },
    success: sourceProcessingSchema,
    error: failureSchema
  }),
  Rpc.make('addLink', {
    payload: {
      url: Schema.String,
      projectId: Schema.NullOr(projectIdSchema),
      name: Schema.optional(Schema.String)
    },
    success: sourceSchema,
    error: failureSchema
  }),
  Rpc.make('createSource', {
    payload: {
      name: Schema.String.check(Schema.isMinLength(1)),
      bytes: Schema.Uint8Array,
      projectId: Schema.NullOr(projectIdSchema)
    },
    success: sourceSchema,
    error: failureSchema
  }),
  Rpc.make('replaceSource', {
    payload: {
      id: sourceIdSchema,
      expectedRevision: sourceRevisionSchema,
      name: Schema.String,
      bytes: Schema.Uint8Array
    },
    success: sourceProcessingSchema,
    error: failureSchema
  }),
  Rpc.make('setSourceProject', {
    payload: setSourceProjectInputSchema,
    success: sourceSchema,
    error: failureSchema
  }),
  Rpc.make('correctBlock', {
    payload: correctBlockInputSchema,
    success: sourceProcessingSchema,
    error: failureSchema
  }),
  Rpc.make('previewDeletion', {
    payload: { id: sourceIdSchema },
    success: sourceDeletionPreviewSchema,
    error: failureSchema
  }),
  Rpc.make('deleteSource', {
    payload: { id: sourceIdSchema },
    success: Schema.Boolean,
    error: failureSchema
  }),
  Rpc.make('requestSourceProcessing', {
    payload: { id: sourceIdSchema, expectedRevision: sourceRevisionSchema },
    success: sourceProcessingSchema,
    error: failureSchema
  })
).prefix('sources.');
