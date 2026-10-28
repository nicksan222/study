import { Effect, Schema, SchemaGetter } from 'effect';

import { learningIdSchema } from '#backend/shared/learning/schemas';

const feedbackSchema = Schema.NullOr(
  Schema.String.pipe(
    Schema.decode({
      decode: SchemaGetter.transform((value) => value.trim()),
      encode: SchemaGetter.transform((value) => value.trim())
    })
  ).check(Schema.isMaxLength(100000))
).pipe(Schema.withDecodingDefault(Effect.succeed(null)));

export const inputSchema = Schema.Struct({
  attemptId: learningIdSchema,
  questionId: learningIdSchema,
  score: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  feedback: feedbackSchema
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
