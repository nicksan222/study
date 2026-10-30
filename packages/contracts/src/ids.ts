import { Schema } from 'effect';

const positiveId = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

export const projectIdSchema = positiveId.pipe(Schema.brand('ProjectId'));

export type ProjectId = typeof projectIdSchema.Type;

export const sourceIdSchema = positiveId.pipe(Schema.brand('SourceId'));

export type SourceId = typeof sourceIdSchema.Type;

export const sessionIdSchema = positiveId.pipe(Schema.brand('SessionId'));

export type SessionId = typeof sessionIdSchema.Type;

export const messageIdSchema = positiveId.pipe(Schema.brand('MessageId'));

export type MessageId = typeof messageIdSchema.Type;

export const partIdSchema = positiveId.pipe(Schema.brand('PartId'));

export type PartId = typeof partIdSchema.Type;

export const versionIdSchema = positiveId.pipe(Schema.brand('VersionId'));

export type VersionId = typeof versionIdSchema.Type;

export const documentIdSchema = positiveId.pipe(Schema.brand('DocumentId'));

export type DocumentId = typeof documentIdSchema.Type;

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
