import type { ContentSnapshotId, SourceId } from '@study/contracts/ids';
import { infiniteQueryOptions } from '@tanstack/react-query';

import { request } from '#client/lib/study-client/request.ts';

type Extraction = { revision: bigint; snapshotId: ContentSnapshotId };

export const sourceHistoryOptions = (sourceId: SourceId, open: boolean) =>
  infiniteQueryOptions({
    queryKey: ['sources', 'history', String(sourceId)],
    enabled: open,
    initialPageParam: undefined as Extraction | undefined,
    queryFn: ({ pageParam, signal }) =>
      request(
        (rpc) => rpc['sources.extractions']({ sourceId, limit: 30, before: pageParam }),
        signal
      ),
    getNextPageParam: (page) => page.next ?? undefined
  });
