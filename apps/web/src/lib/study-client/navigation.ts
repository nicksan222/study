import type { ProjectId, SourceId, StudyDocumentId } from '@study/contracts/ids';
import { Effect } from 'effect';

import type { StudyClient } from './client';
import { collectPages } from './pagination';

export function listSubjectSources(client: StudyClient, project: ProjectId) {
  return collectPages((before: SourceId | undefined) =>
    client['sources.sources']({ limit: 100, before })
  ).pipe(Effect.map((sources) => sources.filter((source) => source.projectId === project)));
}

export function countNavigationDocuments(client: StudyClient, project?: ProjectId) {
  return collectPages((cursor: StudyDocumentId | undefined) =>
    client['documents.documents']({ projectId: project, cursor, limit: 100, archived: false }).pipe(
      Effect.map((page) => ({ items: page.items, next: page.nextCursor }))
    )
  ).pipe(Effect.map((items) => items.filter((item) => item.headVersionId !== null).length));
}
