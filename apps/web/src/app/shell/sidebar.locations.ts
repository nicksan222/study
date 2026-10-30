import type { ProjectId } from '@study/contracts/ids';

import type { SearchResults } from '../../lib/study-client/operations';

export function resultLocation(hit: SearchResults['hits'][number], project?: ProjectId) {
  switch (hit.target.type) {
    case 'project':
      return { to: '/Home', search: { project: String(hit.target.id) } } as const;
    case 'session':
      return {
        to: '/Sessions',
        search: { project: String(hit.target.projectId), id: String(hit.target.sessionId) }
      } as const;
    case 'material':
      return {
        to:
          hit.target.materialKind === 'diagram'
            ? '/Diagrams'
            : hit.target.materialKind === 'flashcards'
              ? '/Flashcards'
              : hit.target.materialKind === 'quiz'
                ? '/Practice'
                : '/MediaList',
        search: { project: String(hit.target.projectId), material: String(hit.target.materialId) }
      } as const;
    case 'question':
      return {
        to: '/Practice',
        search: { project: String(hit.target.projectId), material: String(hit.target.materialId) }
      } as const;
    case 'source':
      return {
        to: '/MediaList',
        search: {
          id: String(hit.target.sourceId),
          ...(project ? { project: String(project) } : {})
        }
      } as const;
  }
}
