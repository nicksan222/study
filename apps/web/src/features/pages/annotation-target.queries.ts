import type { PageId, PageVersionId } from '@study/contracts/ids';
import type { annotationTargetSchema } from '@study/contracts/pages/evidence';
import { validBlockTextRange } from '@study/contracts/sources/document';
import { queryOptions, infiniteQueryOptions } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

type Target = typeof annotationTargetSchema.Type;

export const annotationPageOptions = (pageId: PageId, version: PageVersionId) =>
  queryOptions({
    queryKey: ['pages', 'annotationPage', String(pageId), String(version)],
    queryFn: async ({ signal }) => {
      const exact = await request((rpc) => rpc['pages.version']({ id: version }), signal);

      return exact.pageId === pageId && exact.status === 'published' ? exact : null;
    }
  });

export const retainedRangeOptions = (target: Target, enabled = true) =>
  queryOptions({
    queryKey: [
      'pages',
      'retainedRange',
      [
        target.pageId,
        target.range.versionId,
        target.range.snapshotId,
        target.range.blockId,
        target.range.start,
        target.range.end
      ].join(':')
    ],
    enabled,
    queryFn: async ({ signal }) => {
      const exact = await request(
        (rpc) => rpc['pages.version']({ id: target.range.versionId }),
        signal
      );

      if (
        exact.pageId !== target.pageId ||
        exact.status !== 'published' ||
        exact.snapshotId !== target.range.snapshotId ||
        !validBlockTextRange(exact.document, target.range)
      )
        return null;

      return exact.document.blocks.find((block) => block.id === target.range.blockId)?.text ?? null;
    }
  });

export const annotationVersionsOptions = (pageId: PageId) =>
  infiniteQueryOptions({
    queryKey: ['pages', 'annotationVersions', String(pageId)],
    initialPageParam: undefined as PageVersionId | undefined,
    queryFn: ({ pageParam, signal }) =>
      request((rpc) => rpc['pages.versions']({ pageId, limit: 30, cursor: pageParam }), signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined
  });
