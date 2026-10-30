import { Effect } from 'effect';

import type { ItemFilter } from '../../features/library';
import { searchStudy } from '../../lib/study-client/operations';
import type { SearchInput, SearchResults } from '../../lib/study-client/operations';

export const searchSessions = (input: SearchInput) =>
  Effect.sleep('200 millis').pipe(Effect.andThen(searchStudy(input)));

export function filterSearchHits(
  hits: readonly SearchResults['hits'][number][],
  filter: ItemFilter
) {
  return hits.filter(
    (hit) =>
      filter === 'all' || hit.kind === filter || (filter === 'session' && hit.kind === 'message')
  );
}
