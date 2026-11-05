import { useQuery } from '@tanstack/react-query';
import { useMatches, useParams, useSearch } from '@tanstack/react-router';

import type { PageMetadata } from '#web/lib/navigation/route-contract.ts';

/** Resolves route-owned subject membership without knowing any feature's entity types. */
export function useSidebarContext(metadata: PageMetadata) {
  const search = useSearch({ from: '__root__' });
  const params = useParams({ strict: false });
  const matched = useMatches({ select: (matches) => matches.at(-1)?.status === 'success' });
  const resolve = metadata.sidebar?.owner;
  const options = matched ? resolve?.(params) : undefined;
  const owner = useQuery({
    ...(options ?? { queryKey: ['sidebar', 'unowned-route'] }),
    enabled: options !== undefined
  });
  const ready = !resolve || (matched && owner.isSuccess);
  const requestedProject = resolve
    ? String(
        owner.data?.projectIds.find((id) => String(id) === search.project) ??
          owner.data?.projectIds[0] ??
          ''
      ) || null
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
