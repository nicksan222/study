import { projectIdSchema } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Schema } from 'effect';

export function pagesRouteDeps({ search }: { search: { project?: string } }) {
  return { project: search.project };
}

/** Initial reads belong to the shared route transition; refetches retain the overview. */
export async function pagesRouteLoader({ deps }: { deps: ReturnType<typeof pagesRouteDeps> }) {
  const project = deps.project
    ? Schema.decodeUnknownSync(projectIdSchema)(BigInt(deps.project))
    : undefined;

  await rpc.pages.list.read({ projectId: project, archived: false, limit: 30 });
}
