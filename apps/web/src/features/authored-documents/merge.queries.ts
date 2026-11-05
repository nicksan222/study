import type { mergeRequestSchema } from '@study/contracts/documents/transform';
import type { ProjectId } from '@study/contracts/ids';
import { mutationOptions, queryOptions } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

export const mergeDocumentsOptions = () =>
  mutationOptions({
    mutationFn: (input: typeof mergeRequestSchema.Type) =>
      request((rpc) => rpc['documents.merge'](input)),
    retry: false
  });

export const documentMergesOptions = (projectId?: ProjectId) =>
  queryOptions({
    queryKey: ['documents', 'merges', projectId?.toString()],
    queryFn: ({ signal }) => request((rpc) => rpc['documents.merges']({ projectId }), signal),
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
          ? rpc['documents.cancelTransform']({ requestId })
          : rpc['documents.retryTransform']({ requestId, retryId: crypto.randomUUID() })
      )
  });
