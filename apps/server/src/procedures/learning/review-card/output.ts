import { Schema } from 'effect';

import {
  cardReviewSchema,
  cardScheduleSchema,
  flashcardSnapshotSchema
} from '#server/shared/learning/schemas';

export const outputSchema = Schema.Struct({
  snapshot: flashcardSnapshotSchema,
  schedule: cardScheduleSchema,
  review: cardReviewSchema
});

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
