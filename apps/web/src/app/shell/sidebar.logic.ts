import type { ItemFilter } from '../../features/library';
import type { SearchResults } from '../../lib/study-client/operations';

export function filterSearchHits(
  hits: readonly SearchResults['hits'][number][],
  filter: ItemFilter
) {
  return hits.filter(
    (hit) =>
      filter === 'all' || hit.kind === filter || (filter === 'session' && hit.kind === 'message')
  );
}
