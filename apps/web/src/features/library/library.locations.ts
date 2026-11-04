import type { LibraryItem } from './library.logic';

export function itemLocation(item: LibraryItem, project?: string) {
  if (item.type === 'document')
    return {
      to: '/documents/$documentId',
      params: { documentId: String(item.value.id) },
      search: project ? { project } : {}
    } as const;

  if (item.type === 'source')
    return {
      to: '/sources/$sourceId',
      params: { sourceId: String(item.value.id) },
      search: item.value.projectId ? { project: String(item.value.projectId) } : {}
    } as const;

  return {
    to:
      item.value.kind === 'diagram'
        ? '/diagrams'
        : item.value.kind === 'flashcards'
          ? '/flashcards'
          : '/practice',
    search: { ...(project ? { project } : {}), material: String(item.value.id) }
  } as const;
}

export type LibrarySelection = { source?: string; document?: string };
