import type { MaterialId, MaterialVersionId } from '@study/contracts/ids';
import type {
  evidenceReferenceSchema,
  evidenceResolutionSchema,
  evidenceTargetSchema
} from '@study/contracts/materials/evidence';
import { validDocumentTextRange } from '@study/contracts/sources/document';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { SelectControl } from '@study/ui/select-control';
import { Textarea } from '@study/ui/textarea';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { request } from '../../lib/study-client/request';
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
      {versions.isPending && <p role="status">{t('LoadingStudy')}</p>}
      {versions.isError && (
        <Button onClick={() => void versions.refetch()}>{t('LibraryRefresh')}</Button>
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
  const state = useQuery({
    queryKey: ['materials', 'annotationDocument', String(materialId), String(version)],
    queryFn: async ({ signal }) => {
      const owner = await request(
        (rpc) => rpc['materials.materialVersion']({ id: version }),
        signal
      );
      if (owner.material_id !== materialId) return null;
      return request((rpc) => rpc['materials.materialVersionDocument']({ id: version }), signal);
    }
  });
  const value = state.data;
  const block = value?.document.blocks.find((item) => item.id === blockId);
  return (
    <div>
      {state.isPending && <p role="status">{t('LoadingStudy')}</p>}
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
            <blockquote
              style={{ maxHeight: '12rem', overflow: 'auto', whiteSpace: 'pre-wrap' }}
              aria-label={t('AnnotationPreview')}
            >
              {preview}
            </blockquote>
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
  const state = useQuery({
    queryKey: [
      'materials',
      'resolvedEvidence',
      reference.kind === 'range'
        ? [
            reference.target.materialId,
            reference.target.range.versionId,
            reference.target.range.documentId,
            reference.target.range.blockId,
            reference.target.range.start,
            reference.target.range.end
          ].join(':')
        : [reference.versionId, JSON.stringify(reference.anchor), reference.quote].join(':')
    ],
    enabled: open,
    queryFn: ({ signal }) => request((rpc) => rpc['materials.resolveEvidence'](reference), signal)
  });
  const resolved = state.data;
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t('AnnotationOpenTarget')}</summary>
      {state.isPending && <p role="status">{t('LoadingStudy')}</p>}
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
        <>
          <p>{t(resolved.precision === 'exact' ? 'DocumentExact' : 'DocumentApproximate')}</p>
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
              <ApproximateLocation resolution={resolved} />
            </>
          )}
        </>
      )}
    </details>
  );
}
function RetainedRange({ target }: { target: Target }) {
  const { t } = useI18n();
  const state = useQuery({
    queryKey: [
      'materials',
      'retainedRange',
      [
        target.materialId,
        target.range.versionId,
        target.range.documentId,
        target.range.blockId,
        target.range.start,
        target.range.end
      ].join(':')
    ],
    queryFn: async ({ signal }) => {
      const owner = await request(
        (rpc) => rpc['materials.materialVersion']({ id: target.range.versionId }),
        signal
      );
      if (owner.material_id !== target.materialId) return null;
      const value = await request(
        (rpc) => rpc['materials.materialVersionDocument']({ id: target.range.versionId }),
        signal
      );
      if (
        !validDocumentTextRange(
          value.document,
          { versionId: target.range.versionId, documentId: value.id },
          target.range
        )
      )
        return null;
      return value.document.blocks.find((block) => block.id === target.range.blockId)?.text ?? null;
    }
  });
  const range = target.range;
  return (
    <div>
      <p>
        {String(target.materialId)} · {String(range.versionId)} · {String(range.documentId)} ·{' '}
        {range.blockId} · {range.start}–{range.end}
      </p>
      {state.isPending && <p role="status">{t('LoadingStudy')}</p>}
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
        <p style={{ whiteSpace: 'pre-wrap', maxHeight: '24rem', overflow: 'auto' }}>
          {state.data.slice(0, range.start)}
          <mark>{state.data.slice(range.start, range.end)}</mark>
          {state.data.slice(range.end)}
        </p>
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
