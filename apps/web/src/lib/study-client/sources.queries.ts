import type { ProjectId } from '@study/contracts/ids';
import { queryOptions } from '@tanstack/react-query';

import { listSources } from './operations';

export async function loadSourceLibrary(projectId?: ProjectId, signal?: AbortSignal) {
  return (await listSources(signal)).filter(
    (source) => projectId === undefined || source.projectId === projectId
  );
}

export const sourceLibraryOptions = (projectId?: ProjectId) =>
  queryOptions({
    queryKey: ['sources', 'library', projectId?.toString()],
    queryFn: ({ signal }) => loadSourceLibrary(projectId, signal),
    gcTime: Infinity,
    staleTime: Infinity
  });
