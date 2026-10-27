import type * as schema from '@study/db/schema';

export type ProjectId = (typeof schema.projects.$inferSelect)['id'];

export type SourceId = (typeof schema.sources.$inferSelect)['id'];

export type SessionId = (typeof schema.sessions.$inferSelect)['id'];

export type MessageId = (typeof schema.messages.$inferSelect)['id'];

export type PartId = (typeof schema.message_parts.$inferSelect)['id'];

export type VersionId = (typeof schema.message_versions.$inferSelect)['id'];

export type DocumentId = (typeof schema.documents.$inferSelect)['id'];

export type JobId = (typeof schema.jobs.$inferSelect)['id'];

export type RecordingId = (typeof schema.recordings.$inferSelect)['id'];

export type ChunkId = (typeof schema.chunks.$inferSelect)['id'];

export type ArtifactId = (typeof schema.artifacts.$inferSelect)['id'];

export type CardId = (typeof schema.cards.$inferSelect)['id'];

export type PracticeId = (typeof schema.practices.$inferSelect)['id'];

export type QuestionId = (typeof schema.practice_questions.$inferSelect)['id'];

export type MaterialId = (typeof schema.materials.$inferSelect)['id'];

export type MaterialVersionId = (typeof schema.material_versions.$inferSelect)['id'];

export type QuizAttemptId = (typeof schema.material_quiz_attempts.$inferSelect)['id'];

export type QuizQuestionId = (typeof schema.material_quiz_questions.$inferSelect)['id'];

export type QuizChoiceId = (typeof schema.material_quiz_choices.$inferSelect)['id'];

export type MaterialCardId = (typeof schema.material_card_identities.$inferSelect)['id'];
