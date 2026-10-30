import { Schema } from 'effect';

import { titleSnapshotSchema } from './conversations/schemas.ts';
import { errorKindSchema } from './errors.ts';
import {
  documentIdSchema,
  recordingIdSchema,
  materialIdSchema,
  materialVersionIdSchema,
  projectIdSchema,
  sourceIdSchema,
  sessionIdSchema,
  messageIdSchema,
  versionIdSchema,
  quizAttemptIdSchema,
  quizQuestionIdSchema
} from './ids.ts';
import { materialGenerationKindSchema } from './materials/schemas.ts';

const envelope = {
  eventId: Schema.String,
  causationId: Schema.NullOr(Schema.String),
  correlationId: Schema.String,
  inputVersion: Schema.Int.check(Schema.isGreaterThan(0)),
  depth: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
};

export const sourceIndexedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('SourceIndexed'),
  projectId: projectIdSchema,
  sourceId: sourceIdSchema,
  documentId: documentIdSchema
});

export const sourceDeletedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('SourceDeleted'),
  sourceId: sourceIdSchema
});

export const sourceProjectChangedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('SourceProjectChanged'),
  sourceId: sourceIdSchema
});

export const sourceProcessingFailedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('SourceProcessingFailed'),
  sourceId: sourceIdSchema,
  requestId: Schema.String.check(Schema.isMinLength(1))
});

export const sourceProcessingRequestedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('SourceProcessingRequested'),
  sourceId: sourceIdSchema,
  requestId: Schema.String.check(Schema.isMinLength(1))
});

export const sourceCorrectionRequestedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('SourceCorrectionRequested'),
  sourceId: sourceIdSchema,
  requestId: Schema.String.check(Schema.isMinLength(1)),
  documentId: documentIdSchema,
  ordinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  before: Schema.String,
  after: Schema.String
});

export const sourcePublicationRequestedSchema = Schema.Union([
  sourceProcessingRequestedSchema,
  sourceCorrectionRequestedSchema
]);

export const materialGenerationRequestedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('MaterialGenerationRequested'),
  requestId: Schema.String.check(Schema.isMinLength(1)),
  projectId: projectIdSchema,
  kind: materialGenerationKindSchema
});

export const materialGenerationFailedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('MaterialGenerationFailed'),
  requestId: Schema.String.check(Schema.isMinLength(1)),
  projectId: projectIdSchema,
  kind: materialGenerationKindSchema,
  generationEventId: Schema.String.check(Schema.isMinLength(1)),
  errorKind: errorKindSchema
});

export const materialPublishedSchema = Schema.Struct({
  ...envelope,
  generationRequestId: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  type: Schema.Literal('MaterialPublished'),
  projectId: projectIdSchema,
  materialId: materialIdSchema,
  materialVersionId: materialVersionIdSchema
});

export const conversationGenerationRequestedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('ConversationGenerationRequested'),
  sessionId: sessionIdSchema,
  messageId: messageIdSchema,
  versionId: versionIdSchema,
  requestId: Schema.String.check(Schema.isMinLength(1)),
  operation: Schema.Literals(['reply', 'rewrite'])
});

export const conversationTitleRequestedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('ConversationTitleRequested'),
  ...titleSnapshotSchema.fields
});

export const practiceSlotRequestedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('PracticeSlotRequested'),
  slotId: Schema.String.check(Schema.isUUID()),
  projectId: projectIdSchema,
  epoch: Schema.String.check(Schema.isUUID()),
  generationAttempt: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))
  )
});

export const quizAnswerSubmittedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('QuizAnswerSubmitted'),
  attemptId: quizAttemptIdSchema,
  questionId: quizQuestionIdSchema,
  answerHash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))
});

export const recordingPostRequestedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('RecordingPostRequested'),
  requestId: Schema.String.check(Schema.isMinLength(1)),
  recordingId: recordingIdSchema,
  sessionId: sessionIdSchema,
  projectId: projectIdSchema
});

export const workflowEventSchema = Schema.Union([
  recordingPostRequestedSchema,
  sourceProcessingRequestedSchema,
  sourceCorrectionRequestedSchema,
  sourceIndexedSchema,
  sourceDeletedSchema,
  sourceProjectChangedSchema,
  sourceProcessingFailedSchema,
  materialPublishedSchema,
  materialGenerationRequestedSchema,
  materialGenerationFailedSchema,
  conversationGenerationRequestedSchema,
  conversationTitleRequestedSchema,
  quizAnswerSubmittedSchema,
  practiceSlotRequestedSchema
]);

export type SourceIndexed = typeof sourceIndexedSchema.Type;

export type SourceDeleted = typeof sourceDeletedSchema.Type;

export type SourceProjectChanged = typeof sourceProjectChangedSchema.Type;

export type SourceProcessingFailed = typeof sourceProcessingFailedSchema.Type;

export type SourcePublicationRequested = typeof sourcePublicationRequestedSchema.Type;

export type SourceCorrectionRequested = typeof sourceCorrectionRequestedSchema.Type;

export type SourceProcessingRequested = typeof sourceProcessingRequestedSchema.Type;

export type MaterialGenerationRequested = typeof materialGenerationRequestedSchema.Type;

export type MaterialGenerationFailed = typeof materialGenerationFailedSchema.Type;

export type MaterialPublished = typeof materialPublishedSchema.Type;

export type ConversationGenerationRequested = typeof conversationGenerationRequestedSchema.Type;

export type ConversationTitleRequested = typeof conversationTitleRequestedSchema.Type;

export type QuizAnswerSubmitted = typeof quizAnswerSubmittedSchema.Type;

export type WorkflowEvent = typeof workflowEventSchema.Type;

export type PracticeSlotRequested = typeof practiceSlotRequestedSchema.Type;
