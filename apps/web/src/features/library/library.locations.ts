import type { LibraryItem } from './library.logic';

export function itemLocation(item: LibraryItem, project?: string) {
  return {
    to: item.value.kind === 'flashcards' ? '/flashcards/$materialId' : '/practice/$materialId',
    params: { materialId: String(item.value.id) },
    search: project ? { project } : {}
  } as const;
}
