import type { SourceId } from '@study/contracts';
import { rpc, useIndependentMutation } from '@study/contracts/react';
import { downloadFile } from '@study/ui';
import { Effect } from 'effect';

import { toStudyError } from '#client/lib/study-client/errors.ts';

export function useSourceExport(sourceId: SourceId, revision?: bigint) {
  return useIndependentMutation((_input: void) =>
    Effect.tryPromise({
      try: async () => {
        const original =
          revision !== undefined
            ? await rpc.sources.exportRevision.read({ sourceId, revision })
            : await rpc.sources.sourceExport.read({ id: sourceId }).then((value) => ({
                name: value.source.name,
                mime: value.source.mime,
                bytes: value.bytes
              }));

        downloadFile(
          original.name,
          new Blob([new Uint8Array(original.bytes)], { type: original.mime })
        );
      },
      catch: toStudyError
    })
  );
}
