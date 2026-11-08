import type { PageId, PageVersionId } from '@study/contracts/ids';
import type { Page } from '@study/contracts/pages/types';
import type { QueryClient } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { request } from '#web/lib/study-client/request.ts';

import { releaseBodyPreviews } from '../document-presentation';

export function usePageRetirement(
  document: Page,
  initialMode?: 'history' | 'deletion',
  onClosed?: () => void
) {
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'history' | 'deletion' | undefined>(initialMode);
  const [keepLatest, setKeepLatest] = useState('10');
  const validKeep = validHistoryCount(keepLatest);
  const inspect = useQuery({
    queryKey: ['pages', 'retirement-preview', String(document.id), mode, keepLatest],
    enabled: mode !== undefined && (mode === 'deletion' || validKeep),
    gcTime: 0,
    retry: false,
    queryFn: () =>
      request((rpc) =>
        mode === 'deletion'
          ? rpc['pages.previewDeletion']({ id: document.id })
          : rpc['pages.previewHistory']({
              pageId: document.id,
              keepLatest: Number(keepLatest)
            })
      )
  });
  const preview = inspect.isSuccess && !inspect.isFetching ? inspect.data : undefined;
  const retire = useMutation({
    mutationFn: async () => {
      if (!preview) return;

      if (mode === 'deletion')
        await request((rpc) => rpc['pages.delete']({ pageId: document.id, token: preview.token }));
      else
        await request((rpc) =>
          rpc['pages.retireHistory']({
            pageId: document.id,
            keepLatest: Number(keepLatest),
            token: preview.token
          })
        );

      await releaseVersionBodies(cache, document.id, preview.versionIds);

      if (mode === 'deletion') {
        releasePageBodies(cache, document.id);
        await navigate({
          to: '/pages',
          search: document.projectIds[0] ? { project: String(document.projectIds[0]) } : {}
        });
      }

      void cache.invalidateQueries({ queryKey: ['pages'] });
      void cache.invalidateQueries({ queryKey: ['library'] });
      setMode(undefined);
      onClosed?.();
    },
    onError: async () => {
      if (preview)
        await releaseBodyPreviews(cache, {
          kind: 'page',
          pageId: String(document.id),
          versionIds: preview.versionIds.map(String)
        });
    },
    onSettled: () => {
      // An uncertain retirement must recheck availability before showing cached bodies.
      void cache.invalidateQueries({ queryKey: ['pages'] });
    }
  });

  function open(next: 'history' | 'deletion') {
    retire.reset();
    setMode(next);
  }

  return {
    document,
    mode,
    setMode,
    keepLatest,
    setKeepLatest,
    preview,
    inspect,
    retire,
    validKeep,
    open
  };
}

function validHistoryCount(value: string) {
  const count = Number(value);

  return Number.isInteger(count) && count >= 1 && count <= 1000;
}

async function releaseVersionBodies(
  cache: QueryClient,
  pageId: PageId,
  versionIds: readonly PageVersionId[]
) {
  await releaseBodyPreviews(cache, {
    kind: 'page',
    pageId: String(pageId),
    versionIds: versionIds.map(String)
  });

  for (const id of versionIds) {
    cache.removeQueries({ queryKey: ['pages', 'version', String(id)], exact: true });
    cache.removeQueries({ queryKey: ['document-editor', String(pageId), String(id)] });
  }

  for (const [key, copy] of cache.getQueriesData<{ document?: Page }>({
    queryKey: ['source-copy']
  })) {
    const version = copy?.document?.version;

    if (version && version.pageId === pageId && versionIds.includes(version.id))
      cache.removeQueries({ queryKey: key, exact: true });
  }
}

function releasePageBodies(cache: QueryClient, pageId: PageId) {
  cache.removeQueries({ queryKey: ['pages', 'detail', String(pageId)], exact: true });
  cache.removeQueries({ queryKey: ['pages', 'history', String(pageId)], exact: true });
  cache.removeQueries({ queryKey: ['note-page-drafts', String(pageId)] });

  for (const [key, copy] of cache.getQueriesData<{ document?: Page }>({
    queryKey: ['source-copy']
  }))
    if (copy?.document?.id === pageId) cache.removeQueries({ queryKey: key, exact: true });
}
