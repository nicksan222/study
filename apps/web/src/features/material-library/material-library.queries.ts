import type { MaterialId, MaterialVersionId } from '@study/contracts/ids';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

export const materialOptions = (id: MaterialId) =>
  queryOptions({
    queryKey: ['materials', 'detail', String(id)],
    queryFn: ({ signal }) => request((client) => client['materials.material']({ id }), signal)
  });

export const historyOptions = (materialId: MaterialId) =>
  infiniteQueryOptions({
    queryKey: ['materials', 'history', String(materialId)],
    initialPageParam: undefined as MaterialVersionId | undefined,
    queryFn: ({ pageParam, signal }) =>
      request(
        (client) =>
          client['materials.materialVersions']({ materialId, cursor: pageParam, limit: 30 }),
        signal
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined
  });

export { materialsOptions, versionOptions } from '#web/lib/study-client/materials.queries.ts';
