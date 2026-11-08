import { Schema } from 'effect';

import { errorKindSchema } from './errors.ts';
import {
  contentSnapshotIdSchema,
  recordingIdSchema,
  materialIdSchema,
  pageIdSchema,
  pageAnnotationIdSchema,
  materialVersionIdSchema,
  pageVersionIdSchema,
  projectIdSchema,
  sourceIdSchema,
  noteIdSchema,
  messageIdSchema,
  versionIdSchema,
  quizAttemptIdSchema,
  quizQuestionIdSchema
} from './ids.ts';
import { integrationImportIdSchema } from './integrations/schemas.ts';
import { materialGenerationKindSchema } from './materials/schemas.ts';
import {
  titleSnapshotSchema,
  transformSuggestionFieldSchema,
  transformSuggestionLanguageSchema
} from './notes/schemas.ts';

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
  projectId: Schema.NullOr(projectIdSchema),
  sourceId: sourceIdSchema,
  documentId: contentSnapshotIdSchema
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
  documentId: contentSnapshotIdSchema,
  ordinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  before: Schema.String,
  after: Schema.String
});

const sourcePublicationRequestedSchema = Schema.Union([
  sourceProcessingRequestedSchema,
  sourceCorrectionRequestedSchema
]);

const sourceHistoryPrunedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('SourceHistoryPruned'),
  sourceId: sourceIdSchema,
  snapshotIds: Schema.Array(contentSnapshotIdSchema)
});

export const pageGenerationRequestedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('PageGenerationRequested'),
  requestId: Schema.String.check(Schema.isMinLength(1))
});

const pageGenerationFailedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('PageGenerationFailed'),
  requestId: Schema.String,
  generationEventId: Schema.String,
  errorKind: errorKindSchema
});

const pagePublishedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('PagePublished'),
  versionId: pageVersionIdSchema
});

export const materialGenerationRequestedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('MaterialGenerationRequested'),
  requestId: Schema.String.check(Schema.isMinLength(1)),
  projectId: Schema.optional(projectIdSchema),
  kind: materialGenerationKindSchema
});

export const materialGenerationFailedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('MaterialGenerationFailed'),
  requestId: Schema.String.check(Schema.isMinLength(1)),
  projectId: Schema.optional(projectIdSchema),
  kind: materialGenerationKindSchema,
  generationEventId: Schema.String.check(Schema.isMinLength(1)),
  errorKind: errorKindSchema
});

export const materialPublishedSchema = Schema.Struct({
  ...envelope,
  generationRequestId: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  type: Schema.Literal('MaterialPublished'),
  materialId: materialIdSchema,
  materialVersionId: materialVersionIdSchema
});

const pageAnnotationChangedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('PageAnnotationChanged'),
  annotationId: pageAnnotationIdSchema,
  pageId: pageIdSchema,
  revision: Schema.BigInt.check(
    Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
  )
});

export const noteGenerationRequestedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('NoteGenerationRequested'),
  noteId: noteIdSchema,
  messageId: messageIdSchema,
  versionId: versionIdSchema,
  requestId: Schema.String.check(Schema.isMinLength(1)),
  operation: Schema.Literals(['reply', 'rewrite'])
});

export const materialHistoryPruneRequestedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('MaterialHistoryPruneRequested'),
  operationId: Schema.String.check(Schema.isBetweenLength(1, 200)),
  attempt: Schema.Int
});

export const materialDeletionRequestedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('MaterialDeletionRequested'),
  materialId: materialIdSchema,
  attempt: Schema.Int
});

export const noteDeletionRequestedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('NoteDeletionRequested'),
  noteId: noteIdSchema,
  attempt: Schema.Int
});

export const noteQuestionRequestedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('NoteQuestionRequested'),
  noteId: noteIdSchema,
  messageId: messageIdSchema,
  versionId: versionIdSchema
});

export const noteTitleRequestedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('NoteTitleRequested'),
  ...titleSnapshotSchema.fields
});

export const transformSuggestionRequestedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('TransformSuggestionRequested'),
  noteId: noteIdSchema,
  contextRequestId: Schema.String,
  field: transformSuggestionFieldSchema,
  language: transformSuggestionLanguageSchema
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
  noteId: noteIdSchema,
  projectId: Schema.NullOr(projectIdSchema)
});

export const integrationImportRequestedSchema = Schema.Struct({
  ...envelope,
  type: Schema.Literal('IntegrationImportRequested'),
  importId: integrationImportIdSchema,
  attempt: Schema.Int.check(Schema.isGreaterThan(0))
});

export const workflowEventSchema = Schema.Union([
  integrationImportRequestedSchema,
  sourceHistoryPrunedSchema,
  pageGenerationRequestedSchema,
  pageGenerationFailedSchema,
  pagePublishedSchema,
  materialHistoryPruneRequestedSchema,
  materialDeletionRequestedSchema,
  noteDeletionRequestedSchema,
  recordingPostRequestedSchema,
  sourceProcessingRequestedSchema,
  sourceCorrectionRequestedSchema,
  sourceIndexedSchema,
  sourceDeletedSchema,
  sourceProjectChangedSchema,
  sourceProcessingFailedSchema,
  materialPublishedSchema,
  pageAnnotationChangedSchema,
  materialGenerationRequestedSchema,
  materialGenerationFailedSchema,
  noteGenerationRequestedSchema,
  noteTitleRequestedSchema,
  transformSuggestionRequestedSchema,
  noteQuestionRequestedSchema,
  quizAnswerSubmittedSchema,
  practiceSlotRequestedSchema
]);

export type SourcePublicationRequested = typeof sourcePublicationRequestedSchema.Type;

export type QuizAnswerSubmitted = typeof quizAnswerSubmittedSchema.Type;

export type WorkflowEvent = typeof workflowEventSchema.Type;
