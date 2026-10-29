import { Effect, Schema, SchemaGetter } from 'effect';

export const learningIdSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

export const learningTakeSchema = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 100 })
).pipe(Schema.withDecodingDefault(Effect.succeed(30)));

export const learningTimeSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 0n, maximum: 9223372036854775807n })
);

export const learningRatingSchema = Schema.Literals(['again', 'hard', 'good', 'easy']);

export const quizAnswerSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('open'),
    answer: Schema.String.pipe(
      Schema.decode({
        decode: SchemaGetter.transform((value) => value.trim()),
        encode: SchemaGetter.transform((value) => value.trim())
      })
    ).check(Schema.isMinLength(1), Schema.isMaxLength(100000))
  }),
  Schema.Struct({
    type: Schema.Literal('choice'),
    choiceIds: Schema.mutable(Schema.Array(learningIdSchema)).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(100)
    )
  })
]);

export const flashcardSnapshotSchema = Schema.Struct({
  version_id: Schema.BigInt,
  material_id: Schema.BigInt,
  card_id: Schema.BigInt,
  position: Schema.BigInt,
  front: Schema.String,
  back: Schema.String
});

export const cardScheduleSchema = Schema.Struct({
  card_id: Schema.BigInt,
  due: Schema.BigInt,
  last_review: Schema.NullOr(Schema.BigInt),
  elapsed_days: Schema.BigInt,
  scheduled_days: Schema.BigInt,
  learning_steps: Schema.BigInt,
  state: Schema.Literals(['new', 'learning', 'review', 'relearning']),
  stability: Schema.Number,
  difficulty: Schema.Number,
  reps: Schema.BigInt,
  lapses: Schema.BigInt
});

export const cardReviewSchema = Schema.Struct({
  id: Schema.BigInt,
  card_id: Schema.BigInt,
  version_id: Schema.BigInt,
  reviewed_at: Schema.BigInt,
  rating: learningRatingSchema,
  elapsed_days: Schema.Number
});

export const quizAttemptRowSchema = Schema.Struct({
  id: Schema.BigInt,
  version_id: Schema.BigInt,
  status: Schema.Literals(['in_progress', 'completed']),
  started_at: Schema.BigInt,
  finished_at: Schema.NullOr(Schema.BigInt)
});

export const quizAttemptInProgressQuestionSchema = Schema.Union([
  Schema.Struct({
    id: Schema.BigInt,
    position: Schema.BigInt,
    prompt: Schema.String,
    kind: Schema.Literal('open'),
    answer: Schema.NullOr(Schema.Struct({ type: Schema.Literal('open'), answer: Schema.String }))
  }),
  Schema.Struct({
    id: Schema.BigInt,
    position: Schema.BigInt,
    prompt: Schema.String,
    kind: Schema.Literals(['single_choice', 'multiple_choice']),
    answer: Schema.NullOr(
      Schema.Struct({
        type: Schema.Literal('choice'),
        choiceIds: Schema.mutable(Schema.Array(Schema.BigInt))
      })
    ),
    choices: Schema.mutable(
      Schema.Array(
        Schema.Struct({ id: Schema.BigInt, position: Schema.BigInt, text: Schema.String })
      )
    )
  })
]);

export const quizAttemptCompletedQuestionSchema = Schema.Union([
  Schema.Struct({
    id: Schema.BigInt,
    position: Schema.BigInt,
    prompt: Schema.String,
    kind: Schema.Literal('open'),
    answer: Schema.NullOr(Schema.Struct({ type: Schema.Literal('open'), answer: Schema.String })),
    explanation: Schema.String,
    score: Schema.NullOr(Schema.Number),
    feedback: Schema.NullOr(Schema.String),
    grading: Schema.Literals(['unanswered', 'ungraded', 'graded']),
    referenceAnswer: Schema.NullOr(Schema.String)
  }),
  Schema.Struct({
    id: Schema.BigInt,
    position: Schema.BigInt,
    prompt: Schema.String,
    kind: Schema.Literals(['single_choice', 'multiple_choice']),
    answer: Schema.NullOr(
      Schema.Struct({
        type: Schema.Literal('choice'),
        choiceIds: Schema.mutable(Schema.Array(Schema.BigInt))
      })
    ),
    explanation: Schema.String,
    score: Schema.NullOr(Schema.Number),
    feedback: Schema.NullOr(Schema.String),
    grading: Schema.Literals(['unanswered', 'ungraded', 'graded']),
    choices: Schema.mutable(
      Schema.Array(
        Schema.Struct({
          id: Schema.BigInt,
          position: Schema.BigInt,
          text: Schema.String,
          isCorrect: Schema.Boolean
        })
      )
    )
  })
]);

export const quizAttemptInProgressSchema = Schema.Struct({
  id: Schema.BigInt,
  versionId: Schema.BigInt,
  materialId: Schema.BigInt,
  projectId: Schema.BigInt,
  startedAt: Schema.BigInt,
  status: Schema.Literal('in_progress'),
  questions: Schema.mutable(Schema.Array(quizAttemptInProgressQuestionSchema))
});

export const quizAttemptCompletedSchema = Schema.Struct({
  id: Schema.BigInt,
  versionId: Schema.BigInt,
  materialId: Schema.BigInt,
  projectId: Schema.BigInt,
  startedAt: Schema.BigInt,
  status: Schema.Literal('completed'),
  finishedAt: Schema.BigInt,
  questions: Schema.mutable(Schema.Array(quizAttemptCompletedQuestionSchema)),
  scoring: Schema.Struct({
    complete: Schema.Boolean,
    gradedCount: Schema.Number,
    questionCount: Schema.Number,
    earned: Schema.Number,
    score: Schema.NullOr(Schema.Number)
  })
});

export const quizAttemptSchema = Schema.Union([
  quizAttemptInProgressSchema,
  quizAttemptCompletedSchema
]);

export type QuizAttempt = typeof quizAttemptSchema.Type;

export type CardSnapshot = typeof flashcardSnapshotSchema.Type;
