import { projectIdSchema } from '@study/contracts/ids';
import { Schema } from 'effect';

import type { AppRouterContext } from '#web/app/router-context.ts';
import { documentsOptions } from '#web/lib/study-client/documents.queries.ts';

export function documentsRouteDeps({ search }: { search: { project?: string } }) {
  return { project: search.project };
}

/** Initial reads belong to the shared route transition; refetches retain the overview. */
export async function documentsRouteLoader({
  context,
  deps
}: {
  context: AppRouterContext;
  deps: ReturnType<typeof documentsRouteDeps>;
}) {
  const project = deps.project
    ? Schema.decodeUnknownSync(projectIdSchema)(BigInt(deps.project))
    : undefined;

  await context.queryClient.ensureInfiniteQueryData(documentsOptions(project));
}
