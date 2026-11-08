import { Schema } from 'effect';

const positiveId = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

export const projectIdSchema = positiveId.pipe(Schema.brand('ProjectId'));

export type ProjectId = typeof projectIdSchema.Type;

export const sourceIdSchema = positiveId.pipe(Schema.brand('SourceId'));

export type SourceId = typeof sourceIdSchema.Type;

export const noteIdSchema = positiveId.pipe(Schema.brand('NoteId'));

export type NoteId = typeof noteIdSchema.Type;

export const messageIdSchema = positiveId.pipe(Schema.brand('MessageId'));

export type MessageId = typeof messageIdSchema.Type;

export const partIdSchema = positiveId.pipe(Schema.brand('PartId'));

export type PartId = typeof partIdSchema.Type;

export const versionIdSchema = positiveId.pipe(Schema.brand('VersionId'));

export type VersionId = typeof versionIdSchema.Type;

export const contentSnapshotIdSchema = positiveId.pipe(Schema.brand('ContentSnapshotId'));

export type ContentSnapshotId = typeof contentSnapshotIdSchema.Type;

export const recordingIdSchema = positiveId.pipe(Schema.brand('RecordingId'));

export type RecordingId = typeof recordingIdSchema.Type;

export const chunkIdSchema = positiveId.pipe(Schema.brand('ChunkId'));

export type ChunkId = typeof chunkIdSchema.Type;

export const materialIdSchema = positiveId.pipe(Schema.brand('MaterialId'));

export type MaterialId = typeof materialIdSchema.Type;

export const materialVersionIdSchema = positiveId.pipe(Schema.brand('MaterialVersionId'));

export type MaterialVersionId = typeof materialVersionIdSchema.Type;

export const quizAttemptIdSchema = positiveId.pipe(Schema.brand('QuizAttemptId'));

export type QuizAttemptId = typeof quizAttemptIdSchema.Type;

export const quizQuestionIdSchema = positiveId.pipe(Schema.brand('QuizQuestionId'));

export type QuizQuestionId = typeof quizQuestionIdSchema.Type;

export const quizChoiceIdSchema = positiveId.pipe(Schema.brand('QuizChoiceId'));

export type QuizChoiceId = typeof quizChoiceIdSchema.Type;

export const materialCardIdSchema = positiveId.pipe(Schema.brand('MaterialCardId'));

export type MaterialCardId = typeof materialCardIdSchema.Type;

export const pageIdSchema = positiveId.pipe(Schema.brand('PageId'));

export type PageId = typeof pageIdSchema.Type;

export const pageVersionIdSchema = positiveId.pipe(Schema.brand('PageVersionId'));

export type PageVersionId = typeof pageVersionIdSchema.Type;

export const pageAnnotationIdSchema = positiveId.pipe(Schema.brand('PageAnnotationId'));

export type PageAnnotationId = typeof pageAnnotationIdSchema.Type;

export const quizOrderingItemIdSchema = positiveId.pipe(Schema.brand('QuizOrderingItemId'));

export type QuizOrderingItemId = typeof quizOrderingItemIdSchema.Type;

export const matchingTermIdSchema = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand('MatchingTermId')
);

export type MatchingTermId = typeof matchingTermIdSchema.Type;

export const matchingDefinitionIdSchema = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand('MatchingDefinitionId')
);

export type MatchingDefinitionId = typeof matchingDefinitionIdSchema.Type;
