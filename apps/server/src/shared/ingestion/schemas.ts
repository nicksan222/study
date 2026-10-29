import { Schema } from 'effect';

import { sourceSchema as materialSourceSchema } from '#server/shared/materials/schemas';
import { sourceKinds } from '#server/shared/sources/sniff';

const idSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

const optionalNullableMeasurementSchema = Schema.NullOr(
  Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: 9223372036854775807n }))
);

const dimensionSchema = Schema.NullOr(
  Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n }))
);

const sourceSchema = Schema.Struct({
  ...materialSourceSchema.fields,
  kind: Schema.Literals(sourceKinds)
});

const audioContentSchema = Schema.Struct({
  kind: Schema.Literal('audio'),
  sourceId: idSchema,
  source: sourceSchema,
  durationMs: optionalNullableMeasurementSchema,
  sampleRate: dimensionSchema,
  channels: dimensionSchema
});

const videoContentSchema = Schema.Struct({
  kind: Schema.Literal('video'),
  sourceId: idSchema,
  source: sourceSchema,
  durationMs: optionalNullableMeasurementSchema,
  width: dimensionSchema,
  height: dimensionSchema
});

const imageContentSchema = Schema.Struct({
  kind: Schema.Literal('image'),
  sourceId: idSchema,
  source: sourceSchema,
  width: dimensionSchema,
  height: dimensionSchema
});

const materialKindSchema = Schema.Literals(['file', 'audio', 'video', 'image', 'link']);

const versionBase = {
  id: idSchema,
  material_id: idSchema,
  project_id: idSchema,
  number: idSchema,
  status: Schema.Literal('published'),
  operation: Schema.Literals([
    'original',
    'edit',
    'summarize',
    'translate',
    'generate',
    'extract',
    'transcribe'
  ]),
  creator: Schema.Literals(['user', 'agent', 'import']),
  instruction: Schema.NullOr(Schema.String),
  language: Schema.NullOr(Schema.String),
  created_at: Schema.BigInt,
  published_at: Schema.BigInt,
  inputs: Schema.mutable(Schema.Array(idSchema)),
  parents: Schema.mutable(Schema.Array(idSchema))
};

const publishedVersionSchema = Schema.Union([
  Schema.Struct({
    ...versionBase,
    kind: Schema.Literal('file'),
    content: Schema.Struct({
      kind: Schema.Literal('file'),
      sourceId: idSchema,
      source: sourceSchema
    })
  }),
  Schema.Struct({ ...versionBase, kind: Schema.Literal('audio'), content: audioContentSchema }),
  Schema.Struct({ ...versionBase, kind: Schema.Literal('video'), content: videoContentSchema }),
  Schema.Struct({ ...versionBase, kind: Schema.Literal('image'), content: imageContentSchema }),
  Schema.Struct({
    ...versionBase,
    kind: Schema.Literal('link'),
    content: Schema.Struct({
      kind: Schema.Literal('link'),
      sourceId: idSchema,
      source: sourceSchema
    })
  })
]);

/** Output DTO shared by the file and link ingestion procedures. */
export const ingestedMaterialSchema = Schema.Struct({
  id: idSchema,
  project_id: idSchema,
  kind: materialKindSchema,
  title: Schema.String,
  created_at: Schema.BigInt,
  updated_at: Schema.BigInt,
  archived_at: Schema.NullOr(Schema.BigInt),
  version: publishedVersionSchema,
  latestPublishedVersion: Schema.NullOr(publishedVersionSchema),
  latestDraftVersion: Schema.NullOr(publishedVersionSchema)
});

export type IngestedMaterial = typeof ingestedMaterialSchema.Type;
