import type { SourceId } from '@study/contracts/ids';
import { rpc } from '@study/contracts/react';
import { useAttachmentPreviewUrl } from '@study/ui/attachment-preview';
import { useMemo } from 'react';

export function useAttachmentMedia(id: SourceId | null, enabled: boolean) {
  const state = rpc.sources.sourceExport.useQuery(enabled && id !== null ? { id } : undefined);
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
