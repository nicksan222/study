import { Schema, SchemaGetter } from 'effect';

import {
  materialCardIdSchema,
  materialIdSchema,
  materialVersionIdSchema,
  projectIdSchema,
  quizAttemptIdSchema,
  quizChoiceIdSchema,
  quizQuestionIdSchema
} from '../ids.ts';

export const learningIdSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

export const learningTimeSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 0n, maximum: 9223372036854775807n })
);

export const learningVerdictSchema = Schema.Literals(['correct', 'partly', 'incorrect']);

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
    choiceIds: Schema.mutable(Schema.Array(quizChoiceIdSchema)).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(100)
    )
  })
]);

export const flashcardSnapshotSchema = Schema.Struct({
  version_id: materialVersionIdSchema,
  material_id: materialIdSchema,
  card_id: materialCardIdSchema,
  position: Schema.BigInt,
  front: Schema.String,
  back: Schema.String
});

export const cardScheduleSchema = Schema.Struct({
  card_id: materialCardIdSchema,
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
  card_id: materialCardIdSchema,
  version_id: materialVersionIdSchema,
  reviewed_at: Schema.BigInt,
  rating: learningRatingSchema,
  elapsed_days: Schema.Number
});

export const quizAttemptRowSchema = Schema.Struct({
  id: quizAttemptIdSchema,
  version_id: materialVersionIdSchema,
  status: Schema.Literals(['in_progress', 'completed']),
  started_at: Schema.BigInt,
  finished_at: Schema.NullOr(Schema.BigInt)
});

const quizAttemptQuestionFields = {
  id: quizQuestionIdSchema,
  position: Schema.BigInt,
  prompt: Schema.String
};

const openAttemptQuestionFields = {
  ...quizAttemptQuestionFields,
  kind: Schema.Literal('open'),
  answer: Schema.NullOr(Schema.Struct({ type: Schema.Literal('open'), answer: Schema.String }))
};

const choiceAttemptQuestionFields = {
  ...quizAttemptQuestionFields,
  kind: Schema.Literals(['single_choice', 'multiple_choice']),
  answer: Schema.NullOr(
    Schema.Struct({
      type: Schema.Literal('choice'),
      choiceIds: Schema.mutable(Schema.Array(quizChoiceIdSchema))
    })
  )
};

const quizAttemptInProgressQuestionSchema = Schema.Union([
  Schema.Struct({
    ...openAttemptQuestionFields
  }),
  Schema.Struct({
    ...choiceAttemptQuestionFields,
    choices: Schema.mutable(
      Schema.Array(
        Schema.Struct({ id: quizChoiceIdSchema, position: Schema.BigInt, text: Schema.String })
      )
    )
  })
]);

const quizAttemptCompletedQuestionSchema = Schema.Union([
  Schema.Struct({
    ...openAttemptQuestionFields,
    explanation: Schema.String,
    score: Schema.NullOr(Schema.Number),
    feedback: Schema.NullOr(Schema.String),
    grading: Schema.Literals(['unanswered', 'ungraded', 'graded']),
    referenceAnswer: Schema.NullOr(Schema.String)
  }),
  Schema.Struct({
    ...choiceAttemptQuestionFields,
    explanation: Schema.String,
    score: Schema.NullOr(Schema.Number),
    feedback: Schema.NullOr(Schema.String),
    grading: Schema.Literals(['unanswered', 'ungraded', 'graded']),
    choices: Schema.mutable(
      Schema.Array(
        Schema.Struct({
          id: quizChoiceIdSchema,
          position: Schema.BigInt,
          text: Schema.String,
          isCorrect: Schema.Boolean
        })
      )
    )
  })
]);

export const quizAttemptInProgressSchema = Schema.Struct({
  id: quizAttemptIdSchema,
  versionId: materialVersionIdSchema,
  materialId: materialIdSchema,
  projectId: projectIdSchema,
  startedAt: Schema.BigInt,
  status: Schema.Literal('in_progress'),
  questions: Schema.mutable(Schema.Array(quizAttemptInProgressQuestionSchema))
});

export const quizAttemptCompletedSchema = Schema.Struct({
  id: quizAttemptIdSchema,
  versionId: materialVersionIdSchema,
  materialId: materialIdSchema,
  projectId: projectIdSchema,
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
