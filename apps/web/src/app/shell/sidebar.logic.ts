import type { ItemFilter } from '#web/features/library/index.ts';
import type { SearchResults } from '#web/lib/study-client/operations.ts';

export function filterSearchHits(
  hits: readonly SearchResults['hits'][number][],
  filter: ItemFilter
) {
  return hits.filter(
    (hit) =>
      filter === 'all' || hit.kind === filter || (filter === 'session' && hit.kind === 'message')
  );
}
