import type { restoreSchema } from '@study/contracts/documents/editing';
import type { StudyDocument, StudyDocumentVersion } from '@study/contracts/documents/types';
import type { QueryClient } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

export function restoreDocumentOptions(
  cache: QueryClient,
  document: StudyDocument,
  version: StudyDocumentVersion
) {
  const attemptKey = ['document-restore-attempt', String(document.id), String(version.id)];

  cache.setQueryDefaults(['document-restore-attempt'], { gcTime: Infinity });

  return {
    mutationFn: async () => {
      const input = cache.getQueryData<typeof restoreSchema.Type>(attemptKey) ?? {
        documentId: document.id,
        expectedVersionId: document.headVersionId!,
        restoreVersionId: version.id,
        key: crypto.randomUUID()
      };

      cache.setQueryData(attemptKey, input);

      return request((rpc) => rpc['documents.restore'](input));
    }
  };
}
