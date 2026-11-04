import type { retirementPreviewSchema } from '@study/contracts/documents/rpc';
import type { StudyDocument } from '@study/contracts/documents/types';
import type { StudyDocumentId, StudyDocumentVersionId } from '@study/contracts/ids';
import type { QueryClient } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { request } from '#web/lib/study-client/request.ts';

import { releaseBodyPreviews } from '../document-presentation/body-cache';

type Preview = typeof retirementPreviewSchema.Type;
export function useDocumentRetirement(document: StudyDocument) {
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'history' | 'deletion'>();
  const [keepLatest, setKeepLatest] = useState('10');
  const [preview, setPreview] = useState<Preview>();
  const inspect = useMutation({
    mutationFn: () =>
      request((rpc) =>
        mode === 'deletion'
          ? rpc['documents.previewDeletion']({ id: document.id })
          : rpc['documents.previewHistory']({
              documentId: document.id,
              keepLatest: Number(keepLatest)
            })
      ),
    onSuccess: setPreview
  });
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
        await navigate({ to: '/library', search: {} });
      }
      void cache.invalidateQueries({ queryKey: ['documents'] });
      void cache.invalidateQueries({ queryKey: ['library'] });
      setMode(undefined);
      setPreview(undefined);
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
  const validKeep = validHistoryCount(keepLatest);
  function open(next: 'history' | 'deletion') {
    setPreview(undefined);
    inspect.reset();
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
    setPreview,
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
