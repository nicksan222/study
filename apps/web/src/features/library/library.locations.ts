import type { LibraryItem } from './library.logic';

export function itemLocation(item: LibraryItem) {
  if (item.type === 'source')
    return {
      to: '/media-list',
      search: {
        id: String(item.value.id),
        ...(item.value.projectId ? { project: String(item.value.projectId) } : {})
      }
    } as const;

  return {
    to:
      item.value.kind === 'diagram'
        ? '/diagrams'
        : item.value.kind === 'flashcards'
          ? '/flashcards'
          : '/practice',
    search: { project: String(item.value.project_id), material: String(item.value.id) }
  } as const;
}
