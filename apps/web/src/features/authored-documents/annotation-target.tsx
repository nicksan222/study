import type { annotationTargetSchema } from '@study/contracts/documents/evidence';
import type { StudyDocumentId, StudyDocumentVersionId } from '@study/contracts/ids';
import { validBlockTextRange } from '@study/contracts/sources/document';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { EvidenceExcerpt } from '@study/ui/evidence-target';
import { Loading } from '@study/ui/loading';
import { SelectControl } from '@study/ui/select-control';
import { Textarea } from '@study/ui/textarea';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import {
  annotationVersionsOptions,
  annotationDocumentOptions,
  retainedRangeOptions
} from './annotation-target.queries';

export type Target = typeof annotationTargetSchema.Type;

export function TargetPicker({
  documentId,
  initialVersion,
  onPick
}: {
  documentId: StudyDocumentId;
  initialVersion: StudyDocumentVersionId;
  onPick: (target: Target | undefined) => void;
}) {
  const { t } = useI18n();
  const [version, setVersion] = useState(initialVersion);
  const versions = useInfiniteQuery(annotationVersionsOptions(documentId));

  return (
    <div>
      <SelectControl
        label={t('ReaderVersion')}
        value={String(version)}
        options={[
          { value: String(initialVersion), label: String(initialVersion) },
          ...(versions.data?.pages
            .flatMap((page) => page.items)
            .filter((item) => item.id !== initialVersion && item.status === 'published')
            .map((item) => ({
              value: String(item.id),
              label: String(item.number) + ' · ' + String(item.id)
            })) ?? [])
        ]}
        onValueChange={(selected) => {
          const item = versions.data?.pages
            .flatMap((page) => page.items)
            .find((item) => String(item.id) === selected && item.status === 'published');

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
        documentId={documentId}
        version={version}
        onPick={onPick}
      />
    </div>
  );
}

function BlockPicker({
  documentId,
  version,
  onPick
}: {
  documentId: StudyDocumentId;
  version: StudyDocumentVersionId;
  onPick: (target: Target | undefined) => void;
}) {
  const { t } = useI18n();
  const [blockId, setBlockId] = useState('');
  const [preview, setPreview] = useState('');
  const state = useQuery(annotationDocumentOptions(documentId, version));
  const value = state.isSuccess ? state.data : undefined;
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
                    snapshotId: value.snapshotId,
                    blockId: block.id,
                    start: e.currentTarget.selectionStart,
                    end: e.currentTarget.selectionEnd
                  };
                  const valid =
                    range.end > range.start && validBlockTextRange(value.document, range);

                  setPreview(valid ? block.text.slice(range.start, range.end) : '');
                  onPick(valid ? { documentId, range } : undefined);
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

/** Opens only the exact retained authored version, without following its head. */

export function EvidenceTarget({
  reference,
  preview = false
}: {
  reference: { kind: 'range'; target: Target };
  preview?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(preview);
  const state = useQuery(retainedRangeOptions(reference.target, open));
  const range = reference.target.range;

  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t('AnnotationOpenTarget')}</summary>
      {open && (
        <>
          <p>
            {t('ReaderVersion')} {String(range.versionId)} · {range.blockId} · {range.start}–
            {range.end}
          </p>
          {state.isPending && <Loading label={t('LoadingStudy')} />}
          {(state.isError || state.data === null) && (
            <ErrorState
              title={t('ReaderUnavailable')}
              action={<Button onClick={() => void state.refetch()}>{t('LibraryRefresh')}</Button>}
            />
          )}
          {state.isSuccess && typeof state.data === 'string' && (
            <EvidenceExcerpt kind="retained">
              {state.data.slice(0, range.start)}
              <mark>{state.data.slice(range.start, range.end)}</mark>
              {state.data.slice(range.end)}
            </EvidenceExcerpt>
          )}
        </>
      )}
    </details>
  );
}
