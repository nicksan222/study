import { Schema } from 'effect';

import { quizAttemptRowSchema } from '#backend/shared/learning/schemas';

export const outputSchema = Schema.Struct({
  items: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        attempt: quizAttemptRowSchema,
        materialId: Schema.BigInt,
        projectId: Schema.BigInt
      })
    )
  ),
  nextCursor: Schema.NullOr(Schema.BigInt)
});

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
