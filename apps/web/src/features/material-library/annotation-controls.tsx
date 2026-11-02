import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { SelectControl } from '@study/ui/select-control';
import { Textarea } from '@study/ui/textarea';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { toStudyError } from '../../lib/study-client/errors';
import { request } from '../../lib/study-client/request';
import { savedDraft, retainAnnotations } from './annotation-state';
import type { Annotation, AnnotationDraft } from './annotation-state';
import { EvidenceTarget, TargetPicker } from './annotation-target';

export function AnnotationControls({ annotation }: { annotation: Annotation }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const key = String(annotation.id);
  const draftKey = ['annotationDraft', key];
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reanchor, setReanchor] = useState(false);
  const latest = useQuery({
    queryKey: ['materials', 'annotation', key],
    queryFn: () => request((rpc) => rpc['materials.annotation']({ id: annotation.id }))
  });
  useEffect(() => {
    const stored = latest.data;
    if (!stored) return;
    client.setQueryData<readonly Annotation[]>(
      ['annotationRetained', String(annotation.target.materialId)],
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
  }, [latest.data, client, key, annotation.target.materialId]);
  const history = useInfiniteQuery({
    queryKey: ['materials', 'annotationHistory', key],
    enabled: historyOpen,
    initialPageParam: undefined as bigint | undefined,
    queryFn: ({ pageParam }) =>
      request((rpc) =>
        rpc['materials.annotationHistory']({ id: annotation.id, limit: 30, cursor: pageParam })
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
    if (
      !submitted ||
      submitted.pending ||
      submitted.uncertain ||
      submitted.current.deleted ||
      submitted.review ||
      submitted.result?.outcome === 'conflict' ||
      submitted.result?.outcome === 'unavailable'
    )
      return;
    if (operation === 'reanchor' && !submitted.target) return;
    client.setQueryData(draftKey, { ...submitted, pending: true, error: undefined });
    try {
      const input = { id: annotation.id, expectedRevision: submitted.current.revision };
      const outcome = await request((rpc) =>
        operation === 'delete'
          ? rpc['materials.deleteAnnotation'](input)
          : operation === 'reanchor' && submitted.target
            ? rpc['materials.reanchorAnnotation']({ ...input, target: submitted.target })
            : rpc['materials.updateAnnotation']({
                ...input,
                note: submitted.note,
                kind: submitted.kind
              })
      );
      if (outcome.outcome === 'saved')
        client.setQueryData<readonly Annotation[]>(
          ['annotationRetained', String(annotation.target.materialId)],
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
                review: outcome.outcome === 'conflict' ? outcome.current : undefined
              })
      );
      await Promise.allSettled([
        client.invalidateQueries({ queryKey: ['materials', 'annotations'] }),
        client.invalidateQueries({ queryKey: ['materials', 'annotationHistory', key] }),
        latest.refetch()
      ]);
    } catch (cause) {
      client.setQueryData<AnnotationDraft>(
        draftKey,
        (old) => old && { ...old, pending: false, uncertain: true, error: toStudyError(cause).kind }
      );
    }
  }
  const blocked =
    draft.pending ||
    draft.uncertain ||
    Boolean(draft.review) ||
    draft.current.deleted ||
    result?.outcome === 'conflict' ||
    result?.outcome === 'unavailable';
  return (
    <div>
      {draft.current.deleted || draft.review?.deleted ? (
        <p role="status">{t('AnnotationDeleted')}</p>
      ) : null}
      <EvidenceTarget reference={{ kind: 'range', target: draft.current.target }} />
      <label>
        {t('DocumentAnnotationNote')}
        <Textarea
          maxLength={100000}
          value={draft.note}
          onChange={(e) => edit({ note: e.target.value })}
        />
      </label>
      <SelectControl
        label={t('AnnotationKind')}
        value={draft.kind}
        options={[
          { value: 'note', label: t('AnnotationNote') },
          { value: 'highlight', label: t('AnnotationHighlight') }
        ]}
        onValueChange={(value) => edit({ kind: value === 'note' ? 'note' : 'highlight' })}
      />
      <Button disabled={blocked} onClick={() => void mutate('update')}>
        {t('DocumentSaveAnnotation')}
      </Button>
      <details open={reanchor} onToggle={(e) => setReanchor(e.currentTarget.open)}>
        <summary>{t('AnnotationReanchor')}</summary>
        {reanchor && (
          <TargetPicker
            materialId={annotation.target.materialId}
            initialVersion={annotation.target.range.versionId}
            onPick={(target) => edit({ target })}
          />
        )}
        {draft.target && (
          <>
            <p>{t('AnnotationPreview')}</p>
            <EvidenceTarget
              preview
              key={targetKey(draft.target)}
              reference={{ kind: 'range', target: draft.target }}
            />
            <Button disabled={blocked} onClick={() => void mutate('reanchor')}>
              {t('AnnotationCommitTarget')}
            </Button>
          </>
        )}
      </details>
      <details>
        <summary>{t('AnnotationDelete')}</summary>
        <p>{t('AnnotationDeleteConfirm')}</p>
        <Button disabled={blocked} onClick={() => void mutate('delete')}>
          {t('AnnotationDelete')}
        </Button>
      </details>
      {draft.pending && <p role="status">{t('LoadingStudy')}</p>}
      {result && (
        <p role="status">
          {t(
            result.outcome === 'saved'
              ? 'DocumentAnnotationSaved'
              : result.outcome === 'conflict'
                ? 'DocumentAnnotationConflict'
                : 'ReaderUnavailable'
          )}
        </p>
      )}
      {draft.review && (
        <section aria-label={t('AnnotationStoredRevision')}>
          <p>
            {t('AnnotationStoredRevision')} {String(draft.review.revision)} ·{' '}
            {t(draft.review.kind === 'note' ? 'AnnotationNote' : 'AnnotationHighlight')}
          </p>
          <p>{draft.review.note}</p>
          <EvidenceTarget reference={{ kind: 'range', target: draft.review.target }} />
          <Button
            disabled={draft.pending}
            onClick={() =>
              client.setQueryData<AnnotationDraft>(draftKey, (old) =>
                old &&
                !old.pending &&
                old.review &&
                old.review.revision === draft.review?.revision &&
                old.review.revision >= old.current.revision
                  ? {
                      ...old,
                      current: old.review,
                      review: undefined,
                      result: undefined,
                      error: undefined,
                      uncertain: false
                    }
                  : old
              )
            }
          >
            {t('AnnotationUseRevision')}
          </Button>
        </section>
      )}
      {(error !== undefined ||
        latest.isError ||
        draft.uncertain ||
        result?.outcome === 'unavailable') && (
        <ErrorState
          title={t('ErrorStateTitle')}
          description={
            <>
              <p>
                {t(
                  error === 'not_found'
                    ? 'ReaderUnavailable'
                    : error === 'invalid_input'
                      ? 'AnnotationInvalid'
                      : 'AnnotationReconcile'
                )}
              </p>
              <Button
                disabled={latest.isFetching || draft.pending}
                onClick={async () => {
                  const refreshed = await latest.refetch();
                  if (refreshed.data && !refreshed.isError) {
                    const stored = refreshed.data;
                    client.setQueryData<AnnotationDraft>(draftKey, (old) =>
                      old &&
                      !old.pending &&
                      stored.revision >= old.current.revision &&
                      (!old.review || stored.revision >= old.review.revision)
                        ? { ...old, review: stored }
                        : old
                    );
                    await client.invalidateQueries({ queryKey: ['materials', 'annotations'] });
                  }
                }}
              >
                {t('AnnotationRefreshRevision')}
              </Button>
            </>
          }
        />
      )}
      <details open={historyOpen} onToggle={(e) => setHistoryOpen(e.currentTarget.open)}>
        <summary>{t('AnnotationHistory')}</summary>
        {history.isPending && <p role="status">{t('LoadingStudy')}</p>}
        {history.isError && (
          <ErrorState
            title={t('ErrorStateTitle')}
            description={
              <>
                {t('DocumentEvidenceFailed')}
                <Button onClick={() => void history.refetch()}>{t('LibraryRefresh')}</Button>
              </>
            }
          />
        )}
        <ol>
          {history.data?.pages
            .flatMap((page) => page.items)
            .map((item) => (
              <li key={String(item.revision)}>
                <p>
                  {String(item.revision)} ·{' '}
                  {t(
                    (
                      {
                        create: 'AnnotationCreated',
                        update: 'AnnotationUpdated',
                        reanchor: 'AnnotationReanchored',
                        delete: 'AnnotationDeleted'
                      } as const
                    )[item.operation]
                  )}{' '}
                  · {t(item.kind === 'note' ? 'AnnotationNote' : 'AnnotationHighlight')}
                  {item.deleted && <> · {t('AnnotationDeleted')}</>}
                </p>
                <p>{item.note}</p>
                <EvidenceTarget reference={{ kind: 'range', target: item.target }} />
              </li>
            ))}
        </ol>
        {history.hasNextPage && (
          <Button
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            {t('LibraryMore')}
          </Button>
        )}
      </details>
    </div>
  );
}
function targetKey(target: NonNullable<AnnotationDraft['target']>) {
  const r = target.range;
  return [target.materialId, r.versionId, r.documentId, r.blockId, r.start, r.end].join(':');
}
