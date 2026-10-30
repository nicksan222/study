import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

import { failureSchema } from '../errors.ts';
import { documentIdSchema, projectIdSchema, sourceIdSchema } from '../ids.ts';
import { sourceSchema } from './schemas.ts';

export const sourceExportSchema = Schema.Struct({ source: sourceSchema, bytes: Schema.Uint8Array });

export const sourceRevisionSchema = Schema.Int.check(Schema.isGreaterThan(0));

/** Processing identity is separate from immutable source metadata. */
export const sourceProcessingSchema = Schema.Struct({
  sourceId: sourceIdSchema,
  revision: sourceRevisionSchema,
  requestId: Schema.NullOr(Schema.String.check(Schema.isMinLength(1))),
  documentId: Schema.NullOr(documentIdSchema)
});

export const setSourceProjectInputSchema = Schema.Struct({
  id: sourceIdSchema,
  projectId: Schema.NullOr(projectIdSchema)
});

export const correctBlockInputSchema = Schema.Struct({
  id: sourceIdSchema,
  documentId: documentIdSchema,
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

export const SourcesRpc = RpcGroup.make(
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
