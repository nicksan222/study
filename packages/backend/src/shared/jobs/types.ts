import type { jobs } from '@study/db/schema';

import type { rowJob } from '#backend/procedures/jobs/worker';
import type {
  JobId,
  SourceId,
  DocumentId,
  SessionId,
  MessageId,
  ArtifactId,
  QuestionId
} from '#backend/shared/ids';
import type { JsonValue } from '#backend/shared/json';

export type JobKind = (typeof jobs.$inferSelect)['kind'];

export type JobStatus = (typeof jobs.$inferSelect)['status'];

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

export type Job = ReturnType<typeof rowJob>;
