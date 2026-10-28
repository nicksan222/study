import { Schema } from 'effect';

import { jobSchema } from '#backend/shared/jobs/schemas';
import { anchorSchema } from '#backend/shared/sources/schemas';
import { cardSchema, memorySchema } from '#backend/shared/study/schemas';

export { cardSchema, memorySchema };

export const practiceScoreSchema = Schema.Struct({
  asked: Schema.Int,
  answered: Schema.Int,
  correct: Schema.Int,
  partly: Schema.Int,
  incorrect: Schema.Int
});

export const practiceSummarySchema = Schema.Struct({
  id: Schema.BigInt,
  projectId: Schema.BigInt,
  createdAt: Schema.BigInt,
  updatedAt: Schema.BigInt,
  score: practiceScoreSchema
});

export const practiceBodySchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('choice'),
    question: Schema.String,
    choices: Schema.mutable(Schema.Array(Schema.String)),
    answer: Schema.Int,
    explanation: Schema.String,
    cites: Schema.mutable(Schema.Array(Schema.Int))
  }),
  Schema.Struct({
    type: Schema.Literal('open'),
    question: Schema.String,
    reference: Schema.String,
    cites: Schema.mutable(Schema.Array(Schema.Int))
  })
]);

export const practiceQuestionSchema = Schema.Struct({
  id: Schema.BigInt,
  practiceId: Schema.BigInt,
  ordinal: Schema.BigInt,
  kind: Schema.Literals(['choice', 'open']),
  status: Schema.Literals(['pending', 'writing', 'ready', 'answered', 'graded']),
  body: Schema.NullOr(practiceBodySchema),
  gist: Schema.NullOr(Schema.String),
  choice: Schema.NullOr(Schema.Int),
  answer: Schema.NullOr(Schema.String),
  verdict: Schema.NullOr(Schema.Literals(['correct', 'partly', 'incorrect'])),
  feedback: Schema.NullOr(Schema.String),
  createdAt: Schema.BigInt,
  answeredAt: Schema.NullOr(Schema.BigInt),
  gradedAt: Schema.NullOr(Schema.BigInt),
  citations: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        marker: Schema.Int,
        sourceId: Schema.NullOr(Schema.BigInt),
        sourceName: Schema.String,
        anchor: anchorSchema,
        quote: Schema.String
      })
    )
  )
});

export const practiceQuestionWithJobSchema = Schema.Struct({
  ...practiceQuestionSchema.fields,
  job: Schema.NullOr(jobSchema)
});
