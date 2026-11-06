import type { StudyDocumentId, StudyDocumentVersionId, ProjectId } from '@study/contracts/ids';
import type { QueryClient } from '@tanstack/react-query';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import { request } from './request';

export const documentsOptions = (projectId?: ProjectId, archived = false) =>
  infiniteQueryOptions({
    queryKey: ['documents', 'library', projectId?.toString(), archived],
    initialPageParam: undefined as StudyDocumentId | undefined,
    queryFn: ({ pageParam, signal }) =>
      request(
        (rpc) =>
          rpc['documents.documents']({
            limit: 30,
            archived,
            projectId,
            cursor: pageParam
          }),
        signal
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined
  });

export const documentVersionOptions = (id: StudyDocumentVersionId) =>
  queryOptions({
    queryKey: ['documents', 'version', String(id)],
    queryFn: ({ signal }) => request((rpc) => rpc['documents.version']({ id }), signal)
  });

/** Authored mutations refresh exact readers and every library/search summary of them. */

export async function invalidateDocuments(cache: QueryClient) {
  await Promise.all(
    ['documents', 'library', 'search'].map((scope) =>
      cache.invalidateQueries({ queryKey: [scope] })
    )
  );
}

export const documentHistoryOptions = (id: StudyDocumentId) =>
  infiniteQueryOptions({
    queryKey: ['documents', 'history', String(id)],
    initialPageParam: undefined as StudyDocumentVersionId | undefined,
    queryFn: ({ pageParam, signal }) =>
      request(
        (rpc) => rpc['documents.versions']({ documentId: id, limit: 30, cursor: pageParam }),
        signal
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined
  });
