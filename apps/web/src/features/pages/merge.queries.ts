import type { ProjectId } from '@study/contracts/ids';
import type { mergeRequestSchema } from '@study/contracts/pages/transform';
import { mutationOptions, queryOptions } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

export const mergePagesOptions = () =>
  mutationOptions({
    mutationFn: (input: typeof mergeRequestSchema.Type) =>
      request((rpc) => rpc['pages.merge'](input)),
    retry: false
  });

export const pageMergesOptions = (projectId?: ProjectId) =>
  queryOptions({
    queryKey: ['pages', 'merges', projectId?.toString()],
    queryFn: ({ signal }) => request((rpc) => rpc['pages.merges']({ projectId }), signal),
    refetchInterval: (query) =>
      query.state.data?.some(
        (item) => !item.cancelled && item.resultVersionId === null && item.errorKind === null
      )
        ? 2000
        : false
  });

export const mergeActionOptions = (requestId: string) =>
  mutationOptions({
    mutationFn: (action: 'cancel' | 'retry') =>
      request((rpc) =>
        action === 'cancel'
          ? rpc['pages.cancelTransform']({ requestId })
          : rpc['pages.retryTransform']({ requestId, retryId: crypto.randomUUID() })
      )
  });
