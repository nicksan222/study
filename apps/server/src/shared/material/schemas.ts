import { Schema } from 'effect';

import { jobSchema } from '#server/shared/jobs/schemas';
import { anchorSchema } from '#server/shared/sources/schemas';
import { cardSchema, memorySchema } from '#server/shared/study/schemas';

export { anchorSchema, cardSchema, memorySchema };

export const materialEntityIdSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

const naturalSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

const citationMarkerSchema = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 4294967295 })
);

export const artifactBodySchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('flashcards'),
    cards: Schema.mutable(
      Schema.Array(
        Schema.Struct({
          front: Schema.String,
          back: Schema.String,
          cites: Schema.mutable(Schema.Array(citationMarkerSchema))
        })
      )
    )
  }),
  Schema.Struct({ type: Schema.Literal('diagram'), mermaid: Schema.String })
]);

export const artifactCitationSchema = Schema.Struct({
  marker: citationMarkerSchema,
  sourceId: Schema.NullOr(materialEntityIdSchema),
  sourceName: Schema.String,
  anchor: anchorSchema,
  quote: Schema.String
});

export const artifactSchema = Schema.Struct({
  id: materialEntityIdSchema,
  projectId: materialEntityIdSchema,
  materialId: Schema.NullOr(materialEntityIdSchema),
  kind: Schema.Literals(['flashcards', 'diagram']),
  title: Schema.String,
  status: Schema.Literals(['pending', 'writing', 'complete']),
  body: Schema.NullOr(artifactBodySchema),
  citations: Schema.mutable(Schema.Array(artifactCitationSchema)),
  sources: Schema.mutable(Schema.Array(Schema.NullOr(materialEntityIdSchema))),
  mistakes: Schema.Boolean,
  practiceId: Schema.NullOr(materialEntityIdSchema),
  createdAt: Schema.BigInt,
  updatedAt: Schema.BigInt
});

export const artifactViewSchema = Schema.Struct({
  ...artifactSchema.fields,
  job: Schema.NullOr(jobSchema)
});

export const materialChangesSchema = Schema.Struct({
  files: naturalSchema,
  notes: naturalSchema
});

export const setCardChangeSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('write'), front: Schema.String, back: Schema.String }),
  Schema.Struct({ type: Schema.Literal('delete') })
]);

export const materialItemSchema = Schema.Struct({
  current: Schema.optional(artifactViewSchema),
  update: Schema.NullOr(artifactViewSchema)
});
