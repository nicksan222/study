import type { MaterialId, MaterialVersionId } from '@study/contracts/ids';
import type {
  evidenceReferenceSchema,
  evidenceResolutionSchema,
  evidenceTargetSchema
} from '@study/contracts/materials/evidence';
import { validDocumentTextRange } from '@study/contracts/sources/document';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { EvidenceExcerpt } from '@study/ui/evidence-target';
import { Loading } from '@study/ui/loading';
import { SelectControl } from '@study/ui/select-control';
import { Textarea } from '@study/ui/textarea';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useI18n } from '../../lib/i18n';
import {
  annotationDocumentOptions,
  resolvedEvidenceOptions,
  retainedRangeOptions
} from './annotation-target.queries';
import { historyOptions } from './material-library.queries';

export type Target = typeof evidenceTargetSchema.Type;

export function TargetPicker({
  materialId,
  initialVersion,
  onPick
}: {
  materialId: MaterialId;
  initialVersion: MaterialVersionId;
  onPick: (target: Target | undefined) => void;
}) {
  const { t } = useI18n();
  const [version, setVersion] = useState(initialVersion);
  const versions = useInfiniteQuery(historyOptions(materialId));

  return (
    <div>
      <SelectControl
        label={t('ReaderVersion')}
        value={String(version)}
        options={[
          { value: String(initialVersion), label: String(initialVersion) },
          ...(versions.data?.pages
            .flatMap((page) => page.items)
            .filter((item) => item.id !== initialVersion && item.availability !== 'unavailable')
            .map((item) => ({
              value: String(item.id),
              label: String(item.number) + ' · ' + String(item.id)
            })) ?? [])
        ]}
        onValueChange={(selected) => {
          const item = versions.data?.pages
            .flatMap((page) => page.items)
            .find((item) => String(item.id) === selected && item.availability !== 'unavailable');

          if (selected === String(initialVersion) || item) {
            setVersion(item?.id ?? initialVersion);
            onPick(undefined);
          }
        }}
      />
      {versions.isPending && <Loading label={t('LoadingStudy')} />}
      {versions.isError && (
        <ErrorState
          title={t('ReaderUnavailable')}
          action={<Button onClick={() => void versions.refetch()}>{t('LibraryRefresh')}</Button>}
        />
      )}
      {versions.hasNextPage && (
        <Button
          disabled={versions.isFetchingNextPage}
          onClick={() => void versions.fetchNextPage()}
        >
          {t('LibraryMore')}
        </Button>
      )}
      <BlockPicker
        key={String(version)}
        materialId={materialId}
        version={version}
        onPick={onPick}
      />
    </div>
  );
}

function BlockPicker({
  materialId,
  version,
  onPick
}: {
  materialId: MaterialId;
  version: MaterialVersionId;
  onPick: (target: Target | undefined) => void;
}) {
  const { t } = useI18n();
  const [blockId, setBlockId] = useState('');
  const [preview, setPreview] = useState('');
  const state = useQuery(annotationDocumentOptions(materialId, version));
  const value = state.data;
  const block = value?.document.blocks.find((item) => item.id === blockId);

  return (
    <div>
      {state.isPending && <Loading label={t('LoadingStudy')} />}
      {(state.isError || value === null) && (
        <ErrorState
          title={t('ErrorStateTitle')}
          description={
            <>
              {t('ReaderUnavailable')}
              <Button onClick={() => void state.refetch()}>{t('LibraryRefresh')}</Button>
            </>
          }
        />
      )}
      {value && (
        <>
          <SelectControl
            label={t('DocumentBlock')}
            value={blockId}
            options={[
              { value: '', label: t('AnnotationChooseBlock') },
              ...value.document.blocks.map((item, index) => ({
                value: item.id,
                label: index + 1 + ' · ' + item.text.slice(0, 80)
              }))
            ]}
            onValueChange={(selected) => {
              setBlockId(selected);
              setPreview('');
              onPick(undefined);
            }}
          />
          {block && (
            <label>
              {t('DocumentSelectPassage')}
              <Textarea
                key={block.id}
                readOnly
                rows={8}
                value={block.text}
                onSelect={(e) => {
                  const range = {
                    versionId: version,
                    documentId: value.id,
                    blockId: block.id,
                    start: e.currentTarget.selectionStart,
                    end: e.currentTarget.selectionEnd
                  };
                  const valid =
                    range.end > range.start &&
                    validDocumentTextRange(
                      value.document,
                      { versionId: version, documentId: value.id },
                      range
                    );

                  setPreview(valid ? block.text.slice(range.start, range.end) : '');
                  onPick(valid ? { materialId, range } : undefined);
                }}
              />
            </label>
          )}
          {preview && (
            <EvidenceExcerpt kind="preview" aria-label={t('AnnotationPreview')}>
              {preview}
            </EvidenceExcerpt>
          )}
        </>
      )}
    </div>
  );
}

/** Opens the retained identity in place; never substitutes current content. */
export function EvidenceTarget({
  reference,
  preview = false
}: {
  reference: typeof evidenceReferenceSchema.Type;
  preview?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(preview);
  const state = useQuery(resolvedEvidenceOptions(reference, open));
  const resolved = state.data;

  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t('AnnotationOpenTarget')}</summary>
      {state.isPending && <Loading label={t('LoadingStudy')} />}
      {state.isError && (
        <ErrorState
          title={t('ErrorStateTitle')}
          description={
            <>
              {t('DocumentEvidenceFailed')}
              <Button onClick={() => void state.refetch()}>{t('LibraryRefresh')}</Button>
            </>
          }
        />
      )}
      {resolved?.availability === 'unavailable' && <p role="status">{t('ReaderUnavailable')}</p>}
      {resolved?.availability === 'available' && (
        <ResolvedEvidence reference={reference} resolution={resolved} />
      )}
    </details>
  );
}

function RetainedRange({ target }: { target: Target }) {
  const { t } = useI18n();
  const state = useQuery(retainedRangeOptions(target));
  const range = target.range;

  return (
    <div>
      <p>
        {String(target.materialId)} · {String(range.versionId)} · {String(range.documentId)} ·{' '}
        {range.blockId} · {range.start}–{range.end}
      </p>
      {state.isPending && <Loading label={t('LoadingStudy')} />}
      {(state.isError || state.data === null) && (
        <ErrorState
          title={t('ErrorStateTitle')}
          description={
            <>
              {t('ReaderUnavailable')}
              <Button onClick={() => void state.refetch()}>{t('LibraryRefresh')}</Button>
            </>
          }
        />
      )}
      {typeof state.data === 'string' && (
        <EvidenceExcerpt kind="retained">
          {state.data.slice(0, range.start)}
          <mark>{state.data.slice(range.start, range.end)}</mark>
          {state.data.slice(range.end)}
        </EvidenceExcerpt>
      )}
    </div>
  );
}

function ApproximateLocation({
  resolution
}: {
  resolution: Extract<typeof evidenceResolutionSchema.Type, { availability: 'available' }>;
}) {
  const { t } = useI18n();
  const anchor = resolution.location;

  if (resolution.locationPrecision === 'unavailable' || anchor.type === 'authored')
    return <p>{t('AnnotationLocationUnavailable')}</p>;

  switch (anchor.type) {
    case 'page':
      return (
        <p>
          {t('AnnotationPage')} {anchor.page}
        </p>
      );
    case 'slide':
      return (
        <p>
          {t('AnnotationSlide')} {anchor.index}
        </p>
      );
    case 'paragraph':
      return (
        <p>
          {t('AnnotationParagraph')} {anchor.index}
        </p>
      );
    case 'time':
      return (
        <p>
          {t('AnnotationTime')} {anchor.startMs}–{anchor.endMs} {t('AnnotationMilliseconds')}
        </p>
      );
    case 'text':
      return (
        <p>
          {t('AnnotationLines')} {anchor.lineStart}–{anchor.lineEnd}
        </p>
      );
    case 'url':
      return (
        <p>
          {t('AnnotationAddress')} {anchor.url}
          {anchor.fragment ? ` · #${anchor.fragment}` : ''}
        </p>
      );
  }
}

function ResolvedEvidence({
  reference,
  resolution
}: {
  reference: typeof evidenceReferenceSchema.Type;
  resolution: Extract<typeof evidenceResolutionSchema.Type, { availability: 'available' }>;
}) {
  const { t } = useI18n();

  return (
    <>
      <p>{t(resolution.precision === 'exact' ? 'DocumentExact' : 'DocumentApproximate')}</p>
      <p>
        {t('ReaderVersion')}{' '}
        {String(
          reference.kind === 'range' ? reference.target.range.versionId : reference.versionId
        )}
      </p>
      {reference.kind === 'range' ? (
        <RetainedRange target={reference.target} />
      ) : (
        <>
          <blockquote>{reference.quote}</blockquote>
          <ApproximateLocation resolution={resolution} />
        </>
      )}
    </>
  );
}
