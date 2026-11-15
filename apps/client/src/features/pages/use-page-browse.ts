import type { PageId, ProjectId } from '@study/contracts';
import { rpc } from '@study/contracts/react';

import { useCursorRecovery, useCursorWindow } from '#client/lib/cursor-window.tsx';

/** Published-page browsers share navigation, owner filters and unavailable-anchor recovery. */
export function usePageBrowse(projectId?: ProjectId, archived = false) {
  const navigation = useCursorWindow<PageId>(`${projectId}:${archived}`);
  const query = rpc.pages.list.useQuery({
    projectId,
    archived,
    limit: navigation.limit,
    cursor: navigation.cursor
  });

  useCursorRecovery(navigation, query.error);

  return { query, navigation };
}
