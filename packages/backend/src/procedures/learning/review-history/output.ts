import { Schema } from 'effect';

import { cardReviewSchema, flashcardSnapshotSchema } from '#backend/shared/learning/schemas';

export const outputSchema = Schema.Struct({
  items: Schema.mutable(
    Schema.Array(Schema.Struct({ review: cardReviewSchema, snapshot: flashcardSnapshotSchema }))
  ),
  nextCursor: Schema.NullOr(Schema.BigInt)
});

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
