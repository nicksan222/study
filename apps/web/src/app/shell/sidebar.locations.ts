import type { ProjectId } from '@study/contracts/ids';

import type { SearchResults } from '../../lib/study-client/operations';

export function resultLocation(hit: SearchResults['hits'][number], project?: ProjectId) {
  const projectSearch = project ? { project: String(project) } : {};

  switch (hit.target.type) {
    case 'project':
      return { to: '/home', search: { project: String(hit.target.id) } } as const;
    case 'session':
      return {
        to: '/sessions',
        search: {
          ...projectSearch,
          id: String(hit.target.sessionId)
        }
      } as const;
    case 'material':
      return {
        to:
          hit.target.materialKind === 'diagram'
            ? '/diagrams'
            : hit.target.materialKind === 'flashcards'
              ? '/flashcards'
              : hit.target.materialKind === 'quiz'
                ? '/practice'
                : '/media-list',
        search: {
          ...projectSearch,
          material: String(hit.target.materialId)
        }
      } as const;
    case 'question':
      return {
        to: '/practice',
        search: {
          ...projectSearch,
          material: String(hit.target.materialId)
        }
      } as const;
    case 'source':
      return {
        to: '/media-list',
        search: {
          id: String(hit.target.sourceId),
          ...projectSearch
        }
      } as const;
  }
}
