import type { ProjectId } from '@study/contracts/ids';

import type { SearchResults } from '../../lib/study-client/operations';

export function resultLocation(hit: SearchResults['hits'][number], project?: ProjectId) {
  switch (hit.target.type) {
    case 'project':
      return { to: '/home', search: { project: String(hit.target.id) } } as const;
    case 'session':
      return {
        to: '/sessions',
        search: { project: String(hit.target.projectId), id: String(hit.target.sessionId) }
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
        search: { project: String(hit.target.projectId), material: String(hit.target.materialId) }
      } as const;
    case 'question':
      return {
        to: '/practice',
        search: { project: String(hit.target.projectId), material: String(hit.target.materialId) }
      } as const;
    case 'source':
      return {
        to: '/media-list',
        search: {
          id: String(hit.target.sourceId),
          ...(project ? { project: String(project) } : {})
        }
      } as const;
  }
}
