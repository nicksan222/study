import type {
  ProjectId,
  SessionId,
  SourceId,
  ChunkId,
  MessageId,
  ArtifactId,
  QuestionId,
  DocumentId
} from '#backend/shared/ids';
import type { Anchor } from '#backend/shared/sources/document';

export type SearchKind =
  | 'project'
  | 'session'
  | 'source'
  | 'passage'
  | 'message'
  | 'material'
  | 'question';

export type SearchTarget =
  | { type: 'project'; id: ProjectId }
  | { type: 'source'; id: SourceId }
  | { type: 'session'; id: SessionId }
  | {
      type: 'passage';
      id: ChunkId;
      documentId: DocumentId;
      sourceId: SourceId;
      anchor: Anchor;
    }
  | { type: 'message'; id: MessageId }
  | { type: 'material'; id: ArtifactId }
  | { type: 'question'; id: QuestionId };

export interface SearchHit {
  target: SearchTarget;
  projectId: ProjectId | null;
  text: string;
  rank: number;
}

export interface SearchOptions {
  projectId?: ProjectId;
  kinds?: SearchKind[];
  limit?: number;
}

export interface PassageDraft {
  firstBlock: number;
  lastBlock: number;
  anchor: Anchor;
  text: string;
}
