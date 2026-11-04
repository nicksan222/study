import { toastManager } from '@study/ui/toast';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useMemo } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { toStudyError } from '#web/lib/study-client/errors.ts';
import { request } from '#web/lib/study-client/request.ts';

import { savedDraft, retainAnnotations } from './annotation-state';
import type { Annotation, AnnotationDraft } from './annotation-state';

/** Coordinates exact-version annotation mutations with confirmation and reconciliation state. */
export function useAnnotationControls({ annotation }: { annotation: Annotation }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const key = String(annotation.id);
  const draftKey = useMemo(() => ['annotationDraft', key], [key]);
  const state = useQuery<AnnotationDraft>({
    queryKey: draftKey,
    queryFn: () => ({
      note: annotation.note,
      kind: annotation.kind,
      current: annotation,
      generation: 0,
      pending: false,
      uncertain: false
    }),
    initialData: {
      note: annotation.note,
      kind: annotation.kind,
      current: annotation,
      generation: 0,
      pending: false,
      uncertain: false
    },
    staleTime: Infinity,
    gcTime: Infinity
  });
  const draft = state.data;
  const { result, error } = draft;
  const [deleting, setDeleting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reanchor, setReanchor] = useState(false);
  const latest = useQuery({
    queryKey: ['documents', 'annotation', key],
    queryFn: () => request((rpc) => rpc['documents.annotation']({ id: annotation.id }))
  });

  useEffect(() => {
    const stored = latest.data;

    if (!stored) return;

    client.setQueryData<readonly Annotation[]>(
      ['annotationRetained', String(annotation.target.documentId)],
      (old) => retainAnnotations(old ?? [], [stored])
    );
    client.setQueryData<AnnotationDraft>(draftKey, (old) =>
      old &&
      !old.pending &&
      stored.revision > old.current.revision &&
      (!old.review || stored.revision > old.review.revision)
        ? { ...old, review: stored }
        : old
    );
  }, [latest.data, client, key, annotation.target.documentId, draftKey]);
  const history = useInfiniteQuery({
    queryKey: ['documents', 'annotationHistory', key],
    enabled: historyOpen,
    initialPageParam: undefined as bigint | undefined,
    queryFn: ({ pageParam }) =>
      request((rpc) =>
        rpc['documents.annotationHistory']({ id: annotation.id, limit: 30, cursor: pageParam })
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined
  });

  function edit(next: Partial<AnnotationDraft>) {
    client.setQueryData<AnnotationDraft>(
      draftKey,
      (old) => old && { ...old, ...next, generation: old.generation + 1 }
    );
  }

  async function mutate(operation: 'update' | 'reanchor' | 'delete') {
    const submitted = client.getQueryData<AnnotationDraft>(draftKey);

    if (!submitted || annotationBlocked(submitted)) return;

    if (operation === 'reanchor' && !submitted.target) return;

    client.setQueryData(draftKey, { ...submitted, pending: true, error: undefined });

    try {
      const input = { id: annotation.id, expectedRevision: submitted.current.revision };
      const outcome = await request((rpc) =>
        rpc['documents.reviseAnnotation']({
          ...input,
          target: operation === 'reanchor' ? submitted.target! : submitted.current.target,
          note: operation === 'update' ? submitted.note : submitted.current.note,
          kind: operation === 'update' ? submitted.kind : submitted.current.kind,
          deleted: operation === 'delete'
        })
      );

      if (outcome.outcome === 'saved')
        client.setQueryData<readonly Annotation[]>(
          ['annotationRetained', String(annotation.target.documentId)],
          (old) => retainAnnotations(old ?? [], [outcome.annotation])
        );

      client.setQueryData<AnnotationDraft>(
        draftKey,
        (old) =>
          old &&
          (outcome.outcome === 'saved'
            ? {
                ...savedDraft(
                  old,
                  operation === 'update' ? submitted.generation : -1,
                  outcome.annotation
                ),
                result: outcome
              }
            : {
                ...old,
                pending: false,
                result: outcome,
                review: outcome.outcome === 'conflict' ? outcome.annotation : undefined
              })
      );

      if (operation === 'delete' && outcome.outcome === 'saved') {
        toastManager.add({ title: t('AnnotationDeleted'), type: 'success' });
        setDeleting(false);
      }

      await Promise.allSettled([
        client.invalidateQueries({ queryKey: ['documents', 'annotations'] }),
        client.invalidateQueries({ queryKey: ['documents', 'annotationHistory', key] }),
        latest.refetch()
      ]);
    } catch (cause) {
      client.setQueryData<AnnotationDraft>(
        draftKey,
        (old) => old && { ...old, pending: false, uncertain: true, error: toStudyError(cause).kind }
      );
    }
  }

  const blocked = annotationBlocked(draft);

  return {
    t,
    client,
    annotation,
    key,
    draftKey,
    draft,
    result,
    error,
    deleting,
    setDeleting,
    historyOpen,
    setHistoryOpen,
    reanchor,
    setReanchor,
    latest,
    history,
    edit,
    mutate,
    blocked
  };
}

function annotationBlocked(draft: AnnotationDraft) {
  return (
    draft.pending ||
    draft.uncertain ||
    Boolean(draft.review) ||
    draft.current.deleted ||
    draft.result?.outcome === 'conflict'
  );
}
