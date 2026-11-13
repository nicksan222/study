import type { PageId, PageVersionId, ProjectId } from '@study/contracts/ids';
import type { QueryClient } from '@tanstack/react-query';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import { request } from './request';

export const pagesOptions = (projectId?: ProjectId, archived = false) =>
  infiniteQueryOptions({
    queryKey: ['pages', 'library', projectId?.toString(), archived],
    initialPageParam: undefined as PageId | undefined,
    queryFn: ({ pageParam, signal }) =>
      request(
        (rpc) =>
          rpc['pages.pages']({
            limit: 30,
            archived,
            projectId,
            cursor: pageParam
          }),
        signal
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined
  });

export const pageVersionOptions = (id: PageVersionId) =>
  queryOptions({
    queryKey: ['pages', 'version', String(id)],
    queryFn: ({ signal }) => request((rpc) => rpc['pages.version']({ id }), signal)
  });

/** Authored mutations refresh exact readers and every library/search summary of them. */

export async function invalidatePages(cache: QueryClient) {
  await Promise.all(
    ['pages', 'library', 'search'].map((scope) => cache.invalidateQueries({ queryKey: [scope] }))
  );
}

export const pageHistoryOptions = (id: PageId) =>
  infiniteQueryOptions({
    queryKey: ['pages', 'history', String(id)],
    initialPageParam: undefined as PageVersionId | undefined,
    queryFn: ({ pageParam, signal }) =>
      request((rpc) => rpc['pages.versions']({ pageId: id, limit: 30, cursor: pageParam }), signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined
  });
