import type { PageId, PageVersionId } from '@study/contracts/ids';
import { mutationOptions, queryOptions } from '@tanstack/react-query';

import { request } from '#client/lib/study-client/request.ts';

type Intent = {
  pageId: PageId;
  mode?: 'item' | 'version';
  versionId?: PageVersionId;
};

export const notebookDeletionPreviewOptions = ({ pageId, mode, versionId }: Intent) =>
  queryOptions({
    queryKey: ['pages', 'notebook-deletion', String(pageId), mode, String(versionId)],
    enabled: mode === 'item' || (mode === 'version' && versionId !== undefined),
    retry: false,
    queryFn: ({ signal }) =>
      request(
        (rpc) =>
          mode === 'item'
            ? rpc['pages.previewDeletion']({ id: pageId })
            : rpc['pages.previewHistory']({ pageId, keepLatest: 1, versionId }),
        signal
      )
  });

export const notebookDeletionOptions = ({
  pageId,
  mode,
  versionId,
  token
}: Intent & { token?: string }) =>
  mutationOptions({
    retry: false,
    mutationFn: async () => {
      if (!token) return;

      if (mode === 'item') await request((rpc) => rpc['pages.delete']({ pageId, token }));
      else
        await request((rpc) =>
          rpc['pages.retireHistory']({ pageId, keepLatest: 1, versionId, token })
        );
    }
  });
