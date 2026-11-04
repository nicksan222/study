import type { SearchResults } from '../study-client/operations';

type Hit = SearchResults['hits'][number];

/** Search results navigate to their owning domain; learning hits preserve exact versions. */
export function searchResultLocation(hit: Hit, project?: string) {
  const search = project ? { project } : {};
  const target = hit.target;
  switch (target.type) {
    case 'project':
      return { to: '/home', search: { project: String(target.id) } } as const;
    case 'session':
      return {
        to: '/sessions/$sessionId',
        params: { sessionId: target.sessionId },
        search
      } as const;
    case 'document':
      return {
        to: '/documents/$documentId',
        params: { documentId: String(target.documentId) },
        search
      } as const;
    case 'source':
      return {
        to: '/sources/$sourceId',
        params: { sourceId: String(target.sourceId) },
        search
      } as const;
    case 'material':
    case 'question':
      return {
        to: '/materials/$materialId',
        params: { materialId: String(target.materialId) },
        search: { ...search, version: String(target.versionId) }
      } as const;
  }
}

export function searchResultKey(hit: Hit) {
  const target = hit.target;
  const id =
    target.type === 'project'
      ? target.id
      : target.type === 'session'
        ? target.sessionId
        : target.type === 'document'
          ? target.documentId
          : target.type === 'source'
            ? target.sourceId
            : target.materialId;
  return `${target.type}:${id}:${hit.at}:${hit.excerpt ?? ''}`;
}
