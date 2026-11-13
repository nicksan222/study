import type { MaterialId, MaterialVersionId, ProjectId } from '@study/contracts/ids';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import { request } from './request';

const materialPage = (projectId?: ProjectId, cursor?: MaterialId, signal?: AbortSignal) =>
  request(
    (client) => client['materials.materials']({ limit: 30, archived: false, projectId, cursor }),
    signal
  );

export const materialsOptions = (projectId?: ProjectId) =>
  infiniteQueryOptions({
    queryKey: ['materials', 'library', projectId?.toString()],
    initialPageParam: undefined as MaterialId | undefined,
    queryFn: ({ pageParam, signal }) => materialPage(projectId, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    gcTime: Infinity,
    staleTime: Infinity
  });

export const versionOptions = (id: MaterialVersionId) =>
  queryOptions({
    queryKey: ['materials', 'version', String(id)],
    queryFn: ({ signal }) =>
      request((client) => client['materials.materialVersion']({ id }), signal)
  });
