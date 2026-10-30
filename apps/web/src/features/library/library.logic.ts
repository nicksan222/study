import type { ProjectId } from '@study/contracts/ids';

import type { Materials, Sources } from '../../lib/study-client/operations';

export type LibraryItem =
  | { type: 'source'; value: Sources[number] }
  | { type: 'material'; value: Materials[number] };

export type ItemFilter = 'all' | 'session' | 'source' | 'diagram' | 'flashcards' | 'quiz';

export function libraryItems(
  section: 'library' | 'practice',
  sources: Sources,
  materials: Materials,
  project?: ProjectId
): LibraryItem[] {
  const items: LibraryItem[] = [
    ...sources
      .filter((source) => section === 'library' && (!project || source.projectId === project))
      .map((value): LibraryItem => ({ type: 'source', value })),
    ...materials
      .filter(
        (material) =>
          (!project || material.project_id === project) &&
          (section === 'library'
            ? material.kind === 'diagram'
            : material.kind === 'flashcards' || material.kind === 'quiz')
      )
      .map((value): LibraryItem => ({ type: 'material', value }))
  ];

  return items.sort((a, b) => {
    const at = a.type === 'source' ? a.value.createdAt : a.value.updated_at;
    const bt = b.type === 'source' ? b.value.createdAt : b.value.updated_at;

    return at === bt ? 0 : at > bt ? -1 : 1;
  });
}
