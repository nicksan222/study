import type { StudyDocumentVersion } from '@study/contracts/documents/types';
import type { exportOmissionSchema } from '@study/contracts/exports';
import { downloadFile } from '@study/ui/download';
import { mutationOptions } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

export type Format = 'canonical_json' | 'markdown' | 'html';

export const versionExportOptions = (version: StudyDocumentVersion, format: Format) =>
  mutationOptions({
    mutationFn: async () => {
      if (format === 'canonical_json') {
        const result = await request((rpc) => rpc['documents.exportVersion']({ id: version.id }));

        downloadFile(
          `document-${version.documentId}-v${version.number}.json`,
          new Blob([result.content], { type: 'application/json' })
        );

        const omissions: readonly (typeof exportOmissionSchema.Type)[] = [];

        return omissions;
      }

      const result = await request((rpc) =>
        rpc['documents.exportFile']({ id: version.id, format })
      );

      downloadFile(
        result.filename,
        new Blob([new Uint8Array(result.bytes)], { type: result.mediaType })
      );

      return result.omissions;
    }
  });
