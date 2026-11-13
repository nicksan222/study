import type { ProjectId } from '@study/contracts/ids';

import type { Materials } from '#client/lib/study-client/operations.ts';

export type LibraryItem = { type: 'material'; value: Materials[number] };

export function libraryItems(
  materials: readonly Materials[number][],
  project?: ProjectId
): LibraryItem[] {
  return materials
    .filter(
      (material) =>
        (!project || material.projectIds.includes(project)) &&
        (material.kind === 'flashcards' || material.kind === 'quiz')
    )
    .map((value): LibraryItem => ({ type: 'material', value }))
    .sort((a, b) =>
      a.value.updated_at === b.value.updated_at
        ? 0
        : a.value.updated_at > b.value.updated_at
          ? -1
          : 1
    );
}
