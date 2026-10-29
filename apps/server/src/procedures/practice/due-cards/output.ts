import { Schema } from 'effect';

import { cardSchema } from '#server/shared/practice/schemas';

export const outputSchema = Schema.Struct({
  items: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        card: cardSchema,
        artifactTitle: Schema.String,
        projectId: Schema.NullOr(Schema.BigInt)
      })
    )
  )
});

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
