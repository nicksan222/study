import type { SourceId } from '@study/contracts/ids';

import { request } from '../../lib/study-client/request';

export const retrySourceProcessing = (processing: { sourceId: SourceId; revision: number }) =>
  request((client) =>
    client['sources.requestSourceProcessing']({
      id: processing.sourceId,
      expectedRevision: processing.revision
    })
  );
