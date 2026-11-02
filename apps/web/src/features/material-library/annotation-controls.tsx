import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { SelectControl } from '@study/ui/select-control';
import { Textarea } from '@study/ui/textarea';

import { useAnnotationControls } from './annotation-controls.queries';
import type { Annotation, AnnotationDraft } from './annotation-state';
import { EvidenceTarget, TargetPicker } from './annotation-target';

type AnnotationView = ReturnType<typeof useAnnotationControls>;

export function AnnotationControls({ annotation }: { annotation: Annotation }) {
  const view = useAnnotationControls({ annotation });

  return (
    <div>
      <AnnotationForm view={view} />
      <AnnotationReceipt view={view} />
      <AnnotationReconciliation view={view} />
      <AnnotationHistory view={view} />
    </div>
  );
}

function targetKey(target: NonNullable<AnnotationDraft['target']>) {
  const r = target.range;

  return [target.materialId, r.versionId, r.documentId, r.blockId, r.start, r.end].join(':');
}

function AnnotationForm({ view }: { view: AnnotationView }) {
  const { t, annotation, draft, reanchor, setReanchor, edit, mutate, blocked } = view;

  return (
    <>
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
    </>
  );
}

function AnnotationReceipt({ view }: { view: AnnotationView }) {
  const { t, client, draftKey, draft, result } = view;

  return (
    <>
      {draft.pending && <Loading label={t('LoadingStudy')} />}
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
    </>
  );
}

function AnnotationReconciliation({ view }: { view: AnnotationView }) {
  const { t, client, draftKey, draft, result, error, latest } = view;

  return (
    <>
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
    </>
  );
}

function AnnotationHistory({ view }: { view: AnnotationView }) {
  const { t, historyOpen, setHistoryOpen, history } = view;

  return (
    <>
      <details open={historyOpen} onToggle={(e) => setHistoryOpen(e.currentTarget.open)}>
        <summary>{t('AnnotationHistory')}</summary>
        {history.isPending && <Loading label={t('LoadingStudy')} />}
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
    </>
  );
}
