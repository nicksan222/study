import type { LibraryItem } from './library.logic';

export function itemLocation(item: LibraryItem, project?: string) {
  return {
    to: item.value.kind === 'flashcards' ? '/flashcards' : '/practice',
    search: { ...(project ? { project } : {}), material: String(item.value.id) }
  } as const;
}
