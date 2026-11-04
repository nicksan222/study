import type { SourceId } from '@study/contracts/ids';

import { request } from '#web/lib/study-client/request.ts';

export const retrySourceProcessing = (processing: { sourceId: SourceId; revision: number }) =>
  request((client) =>
    client['sources.requestSourceProcessing']({
      id: processing.sourceId,
      expectedRevision: processing.revision
    })
  );
