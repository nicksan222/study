/** @file Owns schemas within this feature. */

import {
  projectIdSchema,
  sourceIdSchema,
  sourceKindSchema,
  sourceRevisionSchema
} from '@study/contracts';
import { Schema } from 'effect';

const revision = sourceRevisionSchema;

export const request = Schema.String.check(Schema.isMinLength(1));

const bytesSchema = Schema.Uint8Array;

export const inputSchema = Schema.Struct({
  name: Schema.String,
  kind: sourceKindSchema,
  mime: Schema.String,
  origin: Schema.Literals(['attachment', 'import', 'note', 'recording', 'web']),
  projectId: Schema.NullOr(projectIdSchema),
  uri: Schema.NullOr(Schema.String),
  bytes: bytesSchema,
  requestId: request
});

export const changeSchema = Schema.Struct({
  id: sourceIdSchema,
  expectedRevision: revision,
  requestId: request
});

export const replacementSchema = Schema.Struct({
  ...changeSchema.fields,
  bytes: bytesSchema,
  name: Schema.optional(Schema.String),
  kind: Schema.optional(sourceKindSchema),
  mime: Schema.optional(Schema.String),
  uri: Schema.optional(Schema.NullOr(Schema.String))
});

export const snapshotKey = Schema.Struct({ id: sourceIdSchema, revision });

export const snapshotSchema = Schema.Struct({
  revision,
  bytes: bytesSchema,
  kind: sourceKindSchema,
  mime: Schema.String,
  uri: Schema.NullOr(Schema.String)
});
