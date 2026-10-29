import { Schema } from 'effect';

export const outputSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('grading'), jobId: Schema.BigInt }),
  Schema.Struct({
    type: Schema.Literal('graded'),
    verdict: Schema.Literals(['correct', 'partly', 'incorrect'])
  })
]);

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
