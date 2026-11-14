import type { SourceId, ContentSnapshotId } from '@study/contracts/ids';
import { rpc } from '@study/contracts/react';

import { useCursorRecovery, useCursorWindow } from '#client/lib/cursor-window.tsx';

/** A bounded prefix stays one authoritative snapshot when revision ordering changes. */
export function useSourceHistory(sourceId: SourceId, open: boolean) {
  const window = useCursorWindow<{ revision: bigint; snapshotId: ContentSnapshotId }>(
    String(sourceId)
  );
  const limit = window.limit;
  const history = rpc.sources.extractions.useQuery(
    { sourceId, limit, before: window.cursor },
    { enabled: open }
  );

  useCursorRecovery(window, history.error);

  return {
    ...history,
    limit,
    hasPrevious: window.hasPrevious,
    previous: window.previous,
    loadMore: () => window.more(history.data?.next)
  };
}
