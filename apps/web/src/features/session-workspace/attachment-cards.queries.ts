import type { SourceId } from '@study/contracts/ids';
import { useAttachmentPreviewUrl } from '@study/ui/attachment-preview';
import { useQuery, queryOptions } from '@tanstack/react-query';
import { useMemo } from 'react';

import { request } from '../../lib/study-client/request';

export const attachmentSourceOptions = (id: SourceId | null) =>
  queryOptions({
    queryKey: ['sources', 'detail', String(id)],
    enabled: id !== null,
    queryFn: ({ signal }) => request((rpc) => rpc['sources.source']({ id: id! }), signal),
    retry: false,
    staleTime: 30_000
  });

export function useAttachmentMedia(id: SourceId | null, enabled: boolean) {
  const state = useQuery({
    queryKey: ['sources', 'preview-bytes', String(id)],
    enabled: enabled && id !== null,
    queryFn: ({ signal }) => request((rpc) => rpc['sources.sourceExport']({ id: id! }), signal),
    retry: false,
    staleTime: Infinity,
    gcTime: 0
  });
  const blob = useMemo(
    () =>
      state.data && !state.isError && enabled
        ? new Blob([new Uint8Array(state.data.bytes)], { type: state.data.source.mime })
        : undefined,
    [state.data, state.isError, enabled]
  );
  const url = useAttachmentPreviewUrl(blob);

  return { ...state, url };
}
