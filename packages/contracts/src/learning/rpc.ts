import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

import { errorKindSchema, failureSchema } from '../errors.ts';
import {
  materialCardIdSchema,
  materialIdSchema,
  materialVersionIdSchema,
  projectIdSchema,
  quizAttemptIdSchema,
  quizQuestionIdSchema
} from '../ids.ts';
import {
  cardReviewSchema,
  cardScheduleSchema,
  flashcardSnapshotSchema,
  learningIdSchema,
  learningRatingSchema,
  learningTimeSchema,
  quizAnswerSchema,
  quizAttemptCompletedSchema,
  quizAttemptInProgressSchema,
  quizAttemptRowSchema,
  quizAttemptSchema
} from './schemas.ts';

const limit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }));

export const attemptInputSchema = Schema.Struct({ attemptId: quizAttemptIdSchema });

export const cardInputSchema = Schema.Struct({
  versionId: materialVersionIdSchema,
  cardId: materialCardIdSchema
});

export const answerQuestionInputSchema = Schema.Struct({
  ...attemptInputSchema.fields,
  questionId: quizQuestionIdSchema,
  answer: quizAnswerSchema
});

export const gradeResponseInputSchema = Schema.Struct({
  ...attemptInputSchema.fields,
  questionId: quizQuestionIdSchema,
  score: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  feedback: Schema.NullOr(Schema.String.check(Schema.isMaxLength(100000)))
});

export const startQuizInputSchema = Schema.Struct({ versionId: materialVersionIdSchema });

export const reviewCardInputSchema = Schema.Struct({
  ...cardInputSchema.fields,
  rating: learningRatingSchema
});

export const dueCardsInputSchema = Schema.Struct({
  projectId: projectIdSchema,
  before: Schema.optional(learningTimeSchema),
  limit,
  cursor: Schema.optional(Schema.Struct({ due: learningTimeSchema, cardId: materialCardIdSchema }))
});

export const attemptsInputSchema = Schema.Struct({
  projectId: Schema.optional(projectIdSchema),
  materialId: Schema.optional(materialIdSchema),
  cursor: Schema.optional(quizAttemptIdSchema),
  limit
});

export const reviewHistoryInputSchema = Schema.Struct({
  ...cardInputSchema.fields,
  cursor: Schema.optional(learningIdSchema),
  limit
});

export const cardSchema = Schema.Struct({
  snapshot: flashcardSnapshotSchema,
  schedule: Schema.NullOr(cardScheduleSchema)
});

export const reviewedCardSchema = Schema.Struct({
  snapshot: flashcardSnapshotSchema,
  schedule: cardScheduleSchema,
  review: cardReviewSchema
});

export const dueCardSchema = Schema.Struct({ ...cardSchema.fields, due: Schema.BigInt });

export const dueCardsPageSchema = Schema.Struct({
  items: Schema.Array(dueCardSchema),
  nextCursor: Schema.NullOr(Schema.Struct({ due: Schema.BigInt, cardId: materialCardIdSchema }))
});

export const attemptSummarySchema = Schema.Struct({
  attempt: quizAttemptRowSchema,
  materialId: materialIdSchema,
  projectId: projectIdSchema
});

export const attemptsPageSchema = Schema.Struct({
  items: Schema.Array(attemptSummarySchema),
  nextCursor: Schema.NullOr(quizAttemptIdSchema)
});

export const reviewHistoryItemSchema = Schema.Struct({
  review: cardReviewSchema,
  snapshot: flashcardSnapshotSchema
});

export const reviewHistoryPageSchema = Schema.Struct({
  items: Schema.Array(reviewHistoryItemSchema),
  nextCursor: Schema.NullOr(learningIdSchema)
});

export const gradingSnapshotSchema = Schema.Struct({
  attemptId: quizAttemptIdSchema,
  questionId: quizQuestionIdSchema,
  versionId: materialVersionIdSchema,
  materialId: materialIdSchema,
  projectId: projectIdSchema,
  prompt: Schema.String,
  referenceAnswer: Schema.String,
  learnerAnswer: Schema.String
});

export const publishGradeInputSchema = Schema.Struct({
  ...gradeResponseInputSchema.fields,
  expectedAnswerHash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))
});

export const practiceSlotSchema = Schema.Struct({
  slotId: Schema.String.check(Schema.isUUID()),
  projectId: projectIdSchema,
  epoch: Schema.String.check(Schema.isUUID()),
  ordinal: Schema.BigInt,
  kind: Schema.Literals(['choice', 'open']),
  status: Schema.Literals(['pending', 'ready', 'answered', 'cancelled', 'failed']),
  generationAttempt: Schema.BigInt,
  failureKind: Schema.NullOr(errorKindSchema),
  inputVersionIds: Schema.mutable(Schema.Array(materialVersionIdSchema)),
  versionId: Schema.NullOr(materialVersionIdSchema),
  attemptId: Schema.NullOr(quizAttemptIdSchema)
});

export const practiceInputSchema = Schema.Struct({ projectId: projectIdSchema });

export const startPracticeInputSchema = Schema.Struct({
  projectId: projectIdSchema,
  inputVersionIds: Schema.mutable(Schema.Array(materialVersionIdSchema)).check(
    Schema.isBetweenLength(1, 20)
  )
});

export const answerPracticeQuestionInputSchema = Schema.Struct({
  slotId: Schema.String.check(Schema.isUUID()),
  answer: quizAnswerSchema
});

export const retryPracticeQuestionInputSchema = Schema.Struct({
  slotId: Schema.String.check(Schema.isUUID())
});

export const practiceSchema = Schema.Struct({
  projectId: projectIdSchema,
  enabled: Schema.Boolean,
  epoch: Schema.NullOr(Schema.String),
  slots: Schema.Array(practiceSlotSchema)
});

export const publishPracticeSlotInputSchema = Schema.Struct({
  slotId: Schema.String.check(Schema.isUUID()),
  versionId: materialVersionIdSchema
});

export const LearningRpc = RpcGroup.make(
  Rpc.make('practice', {
    payload: practiceInputSchema,
    success: practiceSchema,
    error: failureSchema
  }),
  Rpc.make('startPractice', {
    payload: startPracticeInputSchema,
    success: practiceSchema,
    error: failureSchema
  }),
  Rpc.make('stopPractice', {
    payload: practiceInputSchema,
    success: practiceSchema,
    error: failureSchema
  }),
  Rpc.make('answerPracticeQuestion', {
    payload: answerPracticeQuestionInputSchema,
    success: quizAttemptSchema,
    error: failureSchema
  }),
  Rpc.make('retryPracticeQuestion', {
    payload: retryPracticeQuestionInputSchema,
    success: practiceSlotSchema,
    error: failureSchema
  }),
  Rpc.make('attempt', {
    payload: attemptInputSchema,
    success: quizAttemptSchema,
    error: failureSchema
  }),
  Rpc.make('findAttempt', {
    payload: attemptInputSchema,
    success: Schema.Option(quizAttemptSchema),
    error: failureSchema
  }),
  Rpc.make('card', { payload: cardInputSchema, success: cardSchema, error: failureSchema }),
  Rpc.make('findCard', {
    payload: cardInputSchema,
    success: Schema.Option(cardSchema),
    error: failureSchema
  }),
  Rpc.make('answerQuestion', {
    payload: answerQuestionInputSchema,
    success: quizAttemptInProgressSchema,
    error: failureSchema
  }),
  Rpc.make('finishQuiz', {
    payload: attemptInputSchema,
    success: quizAttemptCompletedSchema,
    error: failureSchema
  }),
  Rpc.make('gradeResponse', {
    payload: gradeResponseInputSchema,
    success: quizAttemptInProgressSchema,
    error: failureSchema
  }),
  Rpc.make('startQuiz', {
    payload: startQuizInputSchema,
    success: quizAttemptInProgressSchema,
    error: failureSchema
  }),
  Rpc.make('reviewCard', {
    payload: reviewCardInputSchema,
    success: reviewedCardSchema,
    error: failureSchema
  }),
  Rpc.make('dueCards', {
    payload: dueCardsInputSchema,
    success: dueCardsPageSchema,
    error: failureSchema
  }),
  Rpc.make('attempts', {
    payload: attemptsInputSchema,
    success: attemptsPageSchema,
    error: failureSchema
  }),
  Rpc.make('reviewHistory', {
    payload: reviewHistoryInputSchema,
    success: reviewHistoryPageSchema,
    error: failureSchema
  })
).prefix('learning.');
