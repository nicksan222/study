import type { SourceId } from '@study/contracts/ids';
import { queryOptions } from '@tanstack/react-query';

import { request } from '../../lib/study-client/request';

/** Keep attachment previews pinned to the original source while its import completes. */
export function attachmentPreviewOptions(sourceId: SourceId | null) {
  return queryOptions({
    queryKey: ['materials', 'imported', String(sourceId)],
    enabled: sourceId !== null,
    queryFn: ({ signal }) =>
      request((client) => client['materials.importedMaterial']({ sourceId: sourceId! }), signal),
    refetchInterval: (query) => (query.state.data ? false : 3000)
  });
}
