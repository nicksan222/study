import type { restoreSchema } from '@study/contracts/documents/editing';
import type { StudyDocument, StudyDocumentVersion } from '@study/contracts/documents/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { invalidateDocuments } from '#web/lib/study-client/documents.queries.ts';
import { request } from '#web/lib/study-client/request.ts';

export function useMakeDocumentCurrent({
  document,
  version,
  onRestored,
  onBusy
}: {
  document: StudyDocument;
  version: StudyDocumentVersion;
  onRestored: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const cache = useQueryClient();
  const attemptKey = ['document-restore-attempt', String(document.id), String(version.id)];

  cache.setQueryDefaults(['document-restore-attempt'], { gcTime: Infinity });
  const mutation = useMutation({
    mutationFn: async () => {
      const input = cache.getQueryData<typeof restoreSchema.Type>(attemptKey) ?? {
        documentId: document.id,
        expectedVersionId: document.headVersionId!,
        restoreVersionId: version.id,
        key: crypto.randomUUID()
      };

      cache.setQueryData(attemptKey, input);

      return request((rpc) => rpc['documents.restore'](input));
    },
    onSuccess: async (outcome) => {
      cache.removeQueries({ queryKey: attemptKey, exact: true });
      await invalidateDocuments(cache);

      if (outcome.outcome === 'saved') onRestored();
    }
  });

  useEffect(() => {
    onBusy(mutation.isPending || mutation.isError);

    return () => onBusy(false);
  }, [onBusy, mutation.isPending, mutation.isError]);

  return mutation;
}
