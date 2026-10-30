import { Schema } from 'effect';

import { documentIdSchema, projectIdSchema, sourceIdSchema } from '../ids.ts';
import { sourceKinds } from './sniff.ts';

export const sourceSchema = Schema.Struct({
  id: sourceIdSchema,
  name: Schema.String,
  kind: Schema.Literals(sourceKinds),
  mime: Schema.String,
  origin: Schema.Literals(['attachment', 'import', 'note', 'recording', 'web']),
  projectId: Schema.NullOr(projectIdSchema),
  projectName: Schema.NullOr(Schema.String),
  sizeBytes: Schema.BigInt,
  sha256: Schema.Uint8Array,
  uri: Schema.NullOr(Schema.String),
  createdAt: Schema.BigInt
});

export type Source = typeof sourceSchema.Type;

export const anchorSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('time'), startMs: Schema.Number, endMs: Schema.Number }),
  Schema.Struct({ type: Schema.Literal('page'), page: Schema.Number }),
  Schema.Struct({
    type: Schema.Literal('text'),
    lineStart: Schema.Number,
    lineEnd: Schema.Number,
    start: Schema.Number,
    end: Schema.Number
  }),
  Schema.Struct({ type: Schema.Literals(['slide', 'paragraph']), index: Schema.Number }),
  Schema.Struct({
    type: Schema.Literal('url'),
    url: Schema.String,
    fragment: Schema.NullOr(Schema.String)
  })
]);

const blockSchema = Schema.Struct({
  kind: Schema.Literals(['paragraph', 'heading', 'list_item', 'table', 'code', 'segment']),
  text: Schema.String,
  anchor: anchorSchema
});

const documentMetaSchema = Schema.Struct({
  extractor: Schema.NullOr(Schema.String),
  extractorVersion: Schema.Number,
  provider: Schema.NullOr(Schema.String),
  durationMs: Schema.NullOr(Schema.Number),
  pageCount: Schema.NullOr(Schema.Number),
  refiners: Schema.mutable(
    Schema.Array(Schema.Struct({ refiner: Schema.String, version: Schema.Number }))
  ),
  waitingFor: Schema.mutable(Schema.Array(Schema.String)),
  corrected: Schema.Boolean
});

const blocksSchema = Schema.mutable(Schema.Array(blockSchema));

export const documentSchema = Schema.Struct({
  blocks: blocksSchema,
  meta: documentMetaSchema
});

export type Document = typeof documentSchema.Type;

export const documentWithIdSchema = Schema.Struct({
  id: documentIdSchema,
  blocks: blocksSchema,
  meta: documentMetaSchema
});

export type DocumentWithId = typeof documentWithIdSchema.Type;
