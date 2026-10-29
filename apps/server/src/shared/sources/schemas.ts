import { Schema } from 'effect';

import { sourceKinds } from './sniff.ts';

const idSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

const arrayBufferUint8ArraySchema = Schema.declare<Uint8Array<ArrayBuffer>>(
  (value): value is Uint8Array<ArrayBuffer> =>
    value instanceof Uint8Array && value.buffer instanceof ArrayBuffer
);

export const sourceSchema = Schema.Struct({
  id: idSchema,
  name: Schema.String,
  kind: Schema.Literals(sourceKinds),
  mime: Schema.String,
  origin: Schema.Literals(['attachment', 'import', 'note', 'recording', 'web']),
  projectId: Schema.NullOr(idSchema),
  projectName: Schema.NullOr(Schema.String),
  sizeBytes: Schema.BigInt,
  sha256: arrayBufferUint8ArraySchema,
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
  id: idSchema,
  blocks: blocksSchema,
  meta: documentMetaSchema
});

export type DocumentWithId = typeof documentWithIdSchema.Type;
