import type { QueryClient } from '@tanstack/react-query';

import { projectsQueryOptions } from '#web/lib/study-client/study.queries.ts';

import { collectionId } from './identity';
import { materialsOptions } from './material-library.queries';

export function libraryRouteDeps({ search }: { search: { project?: string } }) {
  return { project: search.project };
}

export async function libraryRouteLoader({
  context,
  deps
}: {
  context: { queryClient: QueryClient };
  deps: { project?: string };
}) {
  await Promise.all([
    context.queryClient.prefetchInfiniteQuery(materialsOptions(collectionId(deps.project))),
    context.queryClient.prefetchQuery(projectsQueryOptions())
  ]);
}
