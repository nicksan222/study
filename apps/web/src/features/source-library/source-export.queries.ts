import type { SourceId } from '@study/contracts/ids';
import { downloadFile } from '@study/ui/download';
import { mutationOptions } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

export const sourceExportOptions = (sourceId: SourceId, revision?: bigint) =>
  mutationOptions({
    mutationFn: async () => {
      const original =
        revision !== undefined
          ? await request((rpc) => rpc['sources.exportRevision']({ sourceId, revision }))
          : await request((rpc) => rpc['sources.sourceExport']({ id: sourceId })).then((value) => ({
              name: value.source.name,
              mime: value.source.mime,
              bytes: value.bytes
            }));

      downloadFile(
        original.name,
        new Blob([new Uint8Array(original.bytes)], { type: original.mime })
      );
    }
  });
