import type { ProjectId } from '@study/contracts/ids';
import { skipToken, useQuery } from '@tanstack/react-query';
import { useMatches, useParams, useSearch } from '@tanstack/react-router';

import type { PageMetadata } from '#web/lib/navigation/route-contract.ts';
import type { SidebarOwnerResolver } from '#web/lib/study-client/sidebar-owner.queries.ts';

/** Resolves route-owned subject membership without knowing any feature's entity types. */
export function useSidebarContext(metadata: PageMetadata) {
  const search = useSearch({ from: '__root__' });
  const params = useParams({ strict: false });
  const matched = useMatches({ select: (matches) => matches.at(-1)?.status === 'success' });
  const resolve = metadata.sidebar?.owner;
  const options = routeOwnerOptions(resolve, params, matched);
  const owner = useQuery({
    ...(options ?? { queryKey: ['sidebar', 'unowned-route'], queryFn: skipToken }),
    enabled: options !== undefined
  });
  const ready = !resolve || (matched && owner.isSuccess);
  const requestedProject = resolve
    ? ownerProject(owner.data?.projectIds, search.project)
    : (search.project ?? null);

  return {
    requestedProject,
    ready,
    status: matched ? owner.status : ('pending' as const),
    owned: resolve !== undefined,
    reload: () => {
      if (options) void owner.refetch();
    }
  };
}

function ownerProject(ids: readonly ProjectId[] | undefined, preferred?: string) {
  if (!ids?.length) return null;

  return String(ids.find((id) => String(id) === preferred) ?? ids[0]);
}

function routeOwnerOptions(
  resolve: SidebarOwnerResolver | undefined,
  params: Parameters<SidebarOwnerResolver>[0],
  matched: boolean
) {
  if (!resolve || !matched) return undefined;

  return resolve(params);
}
