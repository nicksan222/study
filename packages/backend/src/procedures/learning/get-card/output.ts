import { Schema } from 'effect';

import { cardScheduleSchema, flashcardSnapshotSchema } from '#backend/shared/learning/schemas';

export const outputSchema = Schema.Struct({
  snapshot: flashcardSnapshotSchema,
  schedule: Schema.NullOr(cardScheduleSchema)
});

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
