import type { StudyDocumentId, StudyDocumentVersionId } from '@study/contracts/ids';
import { mutationOptions, queryOptions } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

type Intent = {
  documentId: StudyDocumentId;
  mode?: 'item' | 'version';
  versionId?: StudyDocumentVersionId;
};

export const notebookDeletionPreviewOptions = ({ documentId, mode, versionId }: Intent) =>
  queryOptions({
    queryKey: ['documents', 'notebook-deletion', String(documentId), mode, String(versionId)],
    enabled: mode === 'item' || (mode === 'version' && versionId !== undefined),
    retry: false,
    queryFn: ({ signal }) =>
      request(
        (rpc) =>
          mode === 'item'
            ? rpc['documents.previewDeletion']({ id: documentId })
            : rpc['documents.previewHistory']({ documentId, keepLatest: 1, versionId }),
        signal
      )
  });

export const notebookDeletionOptions = ({
  documentId,
  mode,
  versionId,
  token
}: Intent & { token?: string }) =>
  mutationOptions({
    retry: false,
    mutationFn: async () => {
      if (!token) return;

      if (mode === 'item') await request((rpc) => rpc['documents.delete']({ documentId, token }));
      else
        await request((rpc) =>
          rpc['documents.retireHistory']({ documentId, keepLatest: 1, versionId, token })
        );
    }
  });
