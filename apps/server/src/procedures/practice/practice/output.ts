import { Schema } from 'effect';

import {
  practiceQuestionWithJobSchema,
  practiceScoreSchema
} from '#server/shared/practice/schemas';

export const outputSchema = Schema.Struct({
  value: Schema.NullOr(
    Schema.Struct({
      id: Schema.BigInt,
      projectId: Schema.BigInt,
      createdAt: Schema.BigInt,
      updatedAt: Schema.BigInt,
      score: practiceScoreSchema,
      questions: Schema.mutable(Schema.Array(practiceQuestionWithJobSchema))
    })
  )
});

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
