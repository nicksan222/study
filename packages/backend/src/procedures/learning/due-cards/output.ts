import { Schema } from 'effect';

import { cardScheduleSchema, flashcardSnapshotSchema } from '#backend/shared/learning/schemas';

export const outputSchema = Schema.Struct({
  items: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        snapshot: flashcardSnapshotSchema,
        schedule: Schema.NullOr(cardScheduleSchema),
        due: Schema.BigInt
      })
    )
  ),
  nextCursor: Schema.NullOr(Schema.Struct({ due: Schema.BigInt, cardId: Schema.BigInt }))
});

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
