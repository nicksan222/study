import type {
  JobId,
  SourceId,
  DocumentId,
  SessionId,
  MessageId,
  ArtifactId,
  QuestionId
} from '#backend/shared/ids';
import type { Job as JobDto, jobKindSchema, jobStatusSchema } from '#backend/shared/jobs/schemas';
import type { JsonValue } from '#backend/shared/json';

export type JobKind = typeof jobKindSchema.Type;

export type JobStatus = typeof jobStatusSchema.Type;

export type JobTarget =
  | { type: 'source'; id: SourceId }
  | { type: 'document'; id: DocumentId }
  | { type: 'session'; id: SessionId }
  | { type: 'message'; id: MessageId }
  | { type: 'artifact'; id: ArtifactId }
  | { type: 'question'; id: QuestionId };

export interface NewJob {
  kind: JobKind;
  target: JobTarget;
  args?: JsonValue;
  after?: JobId[];
}

export type Job = Omit<JobDto, 'id' | 'target' | 'args'> & {
  id: JobId;
  target: JobTarget;
  args: JsonValue | null;
};
