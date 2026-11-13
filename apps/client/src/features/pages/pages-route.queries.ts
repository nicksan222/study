import { projectIdSchema } from '@study/contracts/ids';
import type { QueryClient } from '@tanstack/react-query';
import { Schema } from 'effect';

import { pagesOptions } from '#client/lib/study-client/pages.queries.ts';

export function pagesRouteDeps({ search }: { search: { project?: string } }) {
  return { project: search.project };
}

/** Initial reads belong to the shared route transition; refetches retain the overview. */
export async function pagesRouteLoader({
  context,
  deps
}: {
  context: { queryClient: QueryClient };
  deps: ReturnType<typeof pagesRouteDeps>;
}) {
  const project = deps.project
    ? Schema.decodeUnknownSync(projectIdSchema)(BigInt(deps.project))
    : undefined;

  await context.queryClient.ensureInfiniteQueryData(pagesOptions(project));
}
