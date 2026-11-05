import type { StudyDocument } from '@study/contracts/documents/types';
import type { StudyDocumentId, StudyDocumentVersionId } from '@study/contracts/ids';
import type { QueryClient } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { request } from '#web/lib/study-client/request.ts';

import { releaseBodyPreviews } from '../document-presentation';

export function useDocumentRetirement(
  document: StudyDocument,
  initialMode?: 'history' | 'deletion',
  onClosed?: () => void
) {
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'history' | 'deletion' | undefined>(initialMode);
  const [keepLatest, setKeepLatest] = useState('10');
  const validKeep = validHistoryCount(keepLatest);
  const inspect = useQuery({
    queryKey: ['documents', 'retirement-preview', String(document.id), mode, keepLatest],
    enabled: mode !== undefined && (mode === 'deletion' || validKeep),
    gcTime: 0,
    retry: false,
    queryFn: () =>
      request((rpc) =>
        mode === 'deletion'
          ? rpc['documents.previewDeletion']({ id: document.id })
          : rpc['documents.previewHistory']({
              documentId: document.id,
              keepLatest: Number(keepLatest)
            })
      )
  });
  const preview = inspect.isSuccess && !inspect.isFetching ? inspect.data : undefined;
  const retire = useMutation({
    mutationFn: async () => {
      if (!preview) return;

      if (mode === 'deletion')
        await request((rpc) =>
          rpc['documents.delete']({ documentId: document.id, token: preview.token })
        );
      else
        await request((rpc) =>
          rpc['documents.retireHistory']({
            documentId: document.id,
            keepLatest: Number(keepLatest),
            token: preview.token
          })
        );

      await releaseVersionBodies(cache, document.id, preview.versionIds);

      if (mode === 'deletion') {
        releaseDocumentBodies(cache, document.id);
        await navigate({
          to: '/documents',
          search: document.projectIds[0] ? { project: String(document.projectIds[0]) } : {}
        });
      }

      void cache.invalidateQueries({ queryKey: ['documents'] });
      void cache.invalidateQueries({ queryKey: ['library'] });
      setMode(undefined);
      onClosed?.();
    },
    onError: async () => {
      if (preview)
        await releaseBodyPreviews(cache, {
          kind: 'document',
          documentId: String(document.id),
          versionIds: preview.versionIds.map(String)
        });
    },
    onSettled: () => {
      // An uncertain retirement must recheck availability before showing cached bodies.
      void cache.invalidateQueries({ queryKey: ['documents'] });
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
  documentId: StudyDocumentId,
  versionIds: readonly StudyDocumentVersionId[]
) {
  await releaseBodyPreviews(cache, {
    kind: 'document',
    documentId: String(documentId),
    versionIds: versionIds.map(String)
  });

  for (const id of versionIds) {
    cache.removeQueries({ queryKey: ['documents', 'version', String(id)], exact: true });
    cache.removeQueries({ queryKey: ['document-editor', String(documentId), String(id)] });
  }

  for (const [key, copy] of cache.getQueriesData<{ document?: StudyDocument }>({
    queryKey: ['source-copy']
  })) {
    const version = copy?.document?.version;

    if (version && version.documentId === documentId && versionIds.includes(version.id))
      cache.removeQueries({ queryKey: key, exact: true });
  }
}

function releaseDocumentBodies(cache: QueryClient, documentId: StudyDocumentId) {
  cache.removeQueries({ queryKey: ['documents', 'detail', String(documentId)], exact: true });
  cache.removeQueries({ queryKey: ['documents', 'history', String(documentId)], exact: true });
  cache.removeQueries({ queryKey: ['session-document-drafts', String(documentId)] });

  for (const [key, copy] of cache.getQueriesData<{ document?: StudyDocument }>({
    queryKey: ['source-copy']
  }))
    if (copy?.document?.id === documentId) cache.removeQueries({ queryKey: key, exact: true });
}
