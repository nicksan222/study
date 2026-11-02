import type { MaterialAnnotationId } from '@study/contracts/ids';
import type {
  annotationSchema,
  annotationOutcomeSchema,
  createAnnotationSchema
} from '@study/contracts/materials/evidence';
import type { MaterialVersionDetailDto } from '@study/contracts/materials/schemas';
import type { documentTextRangeSchema } from '@study/contracts/sources/schemas';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Textarea } from '@study/ui/textarea';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { request } from '../../lib/study-client/request';
import { AnnotationControls } from './annotation-controls';
import { retainAnnotations } from './annotation-state';
import { EvidenceTarget, TargetPicker } from './annotation-target';

export function EvidenceDetails({ version }: { version: MaterialVersionDetailDto }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  type Creation = {
    note: string;
    range?: typeof documentTextRangeSchema.Type;
    generation: number;
    busy: boolean;
    unresolved?: typeof createAnnotationSchema.Type;
    reviewed: boolean;
    outcome?: typeof annotationOutcomeSchema.Type;
  };
  const creationKey = ['annotationCreation', String(version.id)];
  const creation = useQuery<Creation>({
    queryKey: creationKey,
    initialData: { note: '', generation: 0, busy: false, reviewed: false },
    queryFn: () => ({ note: '', generation: 0, busy: false, reviewed: false }),
    staleTime: Infinity,
    gcTime: Infinity
  });
  const { note, range, busy, unresolved, reviewed, outcome } = creation.data;
  function change(next: Partial<Creation>) {
    client.setQueryData<Creation>(
      creationKey,
      (old) => old && { ...old, ...next, generation: old.generation + 1 }
    );
  }
  const retained = useQuery<readonly (typeof annotationSchema.Type)[]>({
    queryKey: ['annotationRetained', String(version.material_id)],
    initialData: [],
    queryFn: () => [],
    staleTime: Infinity,
    gcTime: Infinity
  });
  const identity = useQuery({
    queryKey: ['materials', 'document', String(version.id)],
    enabled: open,
    queryFn: () => request((rpc) => rpc['materials.materialVersionDocument']({ id: version.id }))
  });

  const citations = useInfiniteQuery({
    queryKey: ['materials', 'citations', String(version.id)],
    enabled: open,
    initialPageParam: undefined as bigint | undefined,
    queryFn: ({ pageParam }) =>
      request((rpc) =>
        rpc['materials.citations']({ id: version.id, limit: 30, cursor: pageParam })
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined
  });
  const annotations = useInfiniteQuery({
    queryKey: ['materials', 'annotations', String(version.material_id)],
    enabled: open,
    initialPageParam: undefined as MaterialAnnotationId | undefined,
    queryFn: ({ pageParam }) =>
      request((rpc) =>
        rpc['materials.annotations']({
          materialId: version.material_id,
          limit: 30,
          cursor: pageParam
        })
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined
  });
  useEffect(() => {
    if (!annotations.data) return;
    client.setQueryData<readonly (typeof annotationSchema.Type)[]>(
      ['annotationRetained', String(version.material_id)],
      (old) =>
        retainAnnotations(
          old ?? [],
          annotations.data.pages.flatMap((page) => page.items)
        )
    );
  }, [annotations.data, client, version.material_id]);
  const possibleMatches = unresolved
    ? retained.data.filter(
        (item) =>
          !item.deleted &&
          item.note === unresolved.note &&
          item.kind === unresolved.kind &&
          item.target.materialId === unresolved.target.materialId &&
          item.target.range.versionId === unresolved.target.range.versionId &&
          item.target.range.documentId === unresolved.target.range.documentId &&
          item.target.range.blockId === unresolved.target.range.blockId &&
          item.target.range.start === unresolved.target.range.start &&
          item.target.range.end === unresolved.target.range.end
      )
    : [];
  return (
    <details
      className="reader-history"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t('DocumentEvidence')}</summary>
      <p>{t('DocumentEvidenceExplanation')}</p>
      {open && (citations.isPending || annotations.isPending) && (
        <p role="status">{t('LoadingStudy')}</p>
      )}
      {identity.isError && (
        <ErrorState
          title={t('ErrorStateTitle')}
          description={
            <>
              {t('ReaderUnavailable')}
              <Button onClick={() => void identity.refetch()}>{t('LibraryRefresh')}</Button>
            </>
          }
        />
      )}
      {citations.data?.pages
        .flatMap((page) => page.items)
        .map((citation) => (
          <blockquote key={String(citation.marker)}>
            <p>{citation.quote}</p>
            {citation.evidence && <EvidenceTarget reference={citation.evidence.reference} />}
            <p>
              {t('DocumentCitation')} {String(citation.marker)} ·{' '}
              {t(
                citation.evidence?.availability === 'available'
                  ? citation.evidence.precision === 'exact'
                    ? 'DocumentExact'
                    : 'DocumentApproximate'
                  : 'ReaderUnavailable'
              )}
            </p>
            <p>
              {t('DocumentSupport')}{' '}
              {t(
                citation.support?.state === 'assessed'
                  ? 'DocumentUserAssessed'
                  : citation.support?.state === 'stale'
                    ? 'DocumentStale'
                    : citation.support?.state === 'unavailable'
                      ? 'ReaderUnavailable'
                      : 'DocumentUnassessed'
              )}
            </p>
            {citation.support && citation.support.state !== 'unassessed' && (
              <>
                <p>
                  {t(
                    citation.support.assessment.judgment === 'supports'
                      ? 'DocumentSupports'
                      : citation.support.assessment.judgment === 'contradicts'
                        ? 'DocumentContradicts'
                        : 'DocumentUncertain'
                  )}
                </p>
                {citation.support.assessment.note && <p>{citation.support.assessment.note}</p>}
                <EvidenceTarget
                  reference={{ kind: 'range', target: citation.support.assessment.claim }}
                />
                <EvidenceTarget
                  reference={{ kind: 'range', target: citation.support.assessment.evidence }}
                />
              </>
            )}
          </blockquote>
        ))}
      {citations.hasNextPage && (
        <Button
          disabled={citations.isFetchingNextPage}
          onClick={() => void citations.fetchNextPage()}
        >
          {t('LibraryMore')}
        </Button>
      )}
      <ul>
        {[
          ...(annotations.data?.pages.flatMap((page) => page.items) ?? []),
          ...retained.data.filter(
            (item) =>
              !annotations.data?.pages.some((page) =>
                page.items.some((visible) => visible.id === item.id)
              )
          )
        ].map((annotation) => (
          <li key={String(annotation.id)}>
            <p>{annotation.note}</p>
            <AnnotationControls annotation={annotation} />
            <p>
              {annotation.evidence.availability === 'available'
                ? annotation.evidence.excerpt
                : t('ReaderUnavailable')}
            </p>
            <p>
              {t('ReaderVersion')} {String(annotation.target.range.versionId)} ·{' '}
              {t(
                annotation.evidence.availability === 'available' &&
                  annotation.evidence.precision === 'exact'
                  ? 'DocumentExact'
                  : 'ReaderUnavailable'
              )}
            </p>
          </li>
        ))}
      </ul>
      {annotations.hasNextPage && (
        <Button
          disabled={annotations.isFetchingNextPage}
          onClick={() => void annotations.fetchNextPage()}
        >
          {t('LibraryMore')}
        </Button>
      )}
      {(citations.isError || annotations.isError) && (
        <ErrorState
          title={t('ErrorStateTitle')}
          description={
            <>
              {t('DocumentEvidenceFailed')}{' '}
              <Button
                onClick={() => {
                  void citations.refetch();
                  void annotations.refetch();
                }}
              >
                {t('LibraryRefresh')}
              </Button>
            </>
          }
        />
      )}
      {open && (
        <>
          <h3>{t('DocumentAnnotate')}</h3>
          <p>{t('DocumentSelectPassage')}</p>
          <TargetPicker
            materialId={version.material_id}
            initialVersion={version.id}
            onPick={(target) => {
              change({ range: target?.range });
            }}
          />
          {range && (
            <>
              <p>{t('AnnotationPreview')}</p>
              <EvidenceTarget
                preview
                reference={{ kind: 'range', target: { materialId: version.material_id, range } }}
              />
            </>
          )}
          <label>
            {t('DocumentAnnotationNote')}
            <Textarea
              value={note}
              disabled={busy}
              maxLength={100000}
              onChange={(event) => change({ note: event.target.value })}
            />
          </label>
          <Button
            disabled={busy || Boolean(unresolved) || !range}
            onClick={async () => {
              const submitted = client.getQueryData<Creation>(creationKey);
              if (!submitted?.range || submitted.busy || submitted.unresolved) return;
              const input = {
                target: { materialId: version.material_id, range: submitted.range },
                kind: submitted.note.trim() ? ('note' as const) : ('highlight' as const),
                note: submitted.note
              };
              client.setQueryData(creationKey, {
                ...submitted,
                busy: true,
                reviewed: false,
                outcome: undefined
              });
              try {
                const result = await request((rpc) => rpc['materials.createAnnotation'](input));
                client.setQueryData<Creation>(
                  creationKey,
                  (old) =>
                    old && {
                      ...old,
                      outcome: result,
                      ...(result.outcome === 'saved' && old.generation === submitted.generation
                        ? { range: undefined, note: '' }
                        : {})
                    }
                );
                if (result.outcome === 'saved') {
                  client.setQueryData<readonly (typeof annotationSchema.Type)[]>(
                    ['annotationRetained', String(version.material_id)],
                    (old) => retainAnnotations(old ?? [], [result.annotation])
                  );
                  await client.invalidateQueries({ queryKey: ['materials', 'annotations'] });
                }
              } catch {
                client.setQueryData<Creation>(
                  creationKey,
                  (old) => old && { ...old, unresolved: input, reviewed: false }
                );
              } finally {
                client.setQueryData<Creation>(creationKey, (old) => old && { ...old, busy: false });
              }
            }}
          >
            {t('DocumentSaveAnnotation')}
          </Button>
        </>
      )}
      {outcome && (
        <p role="status">
          {t(
            outcome.outcome === 'saved'
              ? 'DocumentAnnotationSaved'
              : outcome.outcome === 'conflict'
                ? 'DocumentAnnotationConflict'
                : 'ReaderUnavailable'
          )}
        </p>
      )}
      {unresolved && (
        <ErrorState
          title={t('ErrorStateTitle')}
          description={
            <>
              <p>{t('DocumentAnnotationUncertain')}</p>
              <p>{t('AnnotationSubmittedCreate')}</p>
              <p>{unresolved.note}</p>
              <p>{t(unresolved.kind === 'note' ? 'AnnotationNote' : 'AnnotationHighlight')}</p>
              <EvidenceTarget preview reference={{ kind: 'range', target: unresolved.target }} />
              <p>{t('AnnotationPossibleMatches')}</p>
              <ul>
                {possibleMatches.map((item) => (
                  <li key={String(item.id)}>
                    {String(item.id)} · {item.note}
                  </li>
                ))}
              </ul>
              <Button
                disabled={busy || annotations.isFetching}
                onClick={async () => {
                  const result = await annotations.refetch();
                  client.setQueryData<Creation>(
                    creationKey,
                    (old) => old && { ...old, reviewed: !result.isError && !old.busy }
                  );
                }}
              >
                {t('LibraryRefresh')}
              </Button>
              <Button
                disabled={
                  busy ||
                  !reviewed ||
                  annotations.isFetching ||
                  annotations.isError ||
                  annotations.hasNextPage
                }
                onClick={() =>
                  client.setQueryData<Creation>(creationKey, (old) =>
                    old && !old.busy && old.reviewed
                      ? { ...old, unresolved: undefined, reviewed: false }
                      : old
                  )
                }
              >
                {t('AnnotationCreationReviewed')}
              </Button>
            </>
          }
        />
      )}
    </details>
  );
}
