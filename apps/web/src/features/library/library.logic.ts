import type { StudyDocumentSummary } from '@study/contracts/documents/types';
import type { ProjectId } from '@study/contracts/ids';

import type { Materials, Sources } from '#web/lib/study-client/operations.ts';

export type LibraryItem =
  | { type: 'document'; value: StudyDocumentSummary }
  | { type: 'source'; value: Sources[number] }
  | { type: 'material'; value: Materials[number] };

export function libraryItems(
  section: 'library' | 'practice',
  sources: readonly Sources[number][],
  materials: readonly Materials[number][],
  project?: ProjectId,
  documents: readonly StudyDocumentSummary[] = []
): LibraryItem[] {
  const items: LibraryItem[] = [
    ...documents
      .filter(
        (document) => section === 'library' && (!project || document.projectIds.includes(project))
      )
      .map((value): LibraryItem => ({ type: 'document', value })),
    ...sources
      .filter((source) => section === 'library' && (!project || source.projectId === project))
      .map((value): LibraryItem => ({ type: 'source', value })),
    ...materials
      .filter(
        (material) =>
          (!project || material.projectIds.includes(project)) &&
          (section === 'library'
            ? material.kind === 'diagram'
            : material.kind === 'flashcards' || material.kind === 'quiz')
      )
      .map((value): LibraryItem => ({ type: 'material', value }))
  ];

  return items.sort((a, b) => {
    const at =
      a.type === 'source'
        ? a.value.createdAt
        : a.type === 'document'
          ? a.value.updatedAt
          : a.value.updated_at;
    const bt =
      b.type === 'source'
        ? b.value.createdAt
        : b.type === 'document'
          ? b.value.updatedAt
          : b.value.updated_at;

    return at === bt ? 0 : at > bt ? -1 : 1;
  });
}
