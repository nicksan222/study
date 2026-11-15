import { validBlockTextRange } from '@study/contracts';
import type { PageId, PageVersionId, annotationTargetSchema } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import {
  Button,
  Disclosure,
  ErrorState,
  EvidenceExcerpt,
  Field,
  Loading,
  SelectControl,
  Textarea
} from '@study/ui';
import { useState } from 'react';

import {
  useCursorRecovery,
  useCursorWindow,
  CursorWindowActions
} from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

import { useAnnotationPage, useRetainedRange } from './annotation-target.queries';

export type Target = typeof annotationTargetSchema.Type;

export function TargetPicker({
  pageId,
  initialVersion,
  onPick
}: {
  pageId: PageId;
  initialVersion: PageVersionId;
  onPick: (target: Target | undefined) => void;
}) {
  const { t } = useI18n();
  const [version, setVersion] = useState(initialVersion);
  const window = useCursorWindow<PageVersionId>(String(pageId));
  const limit = window.limit;
  const versions = rpc.pages.versions.useQuery({ pageId, limit, cursor: window.cursor });

  useCursorRecovery(window, versions.error);

  return (
    <div>
      <SelectControl
        label={t('ReaderVersion')}
        value={String(version)}
        options={[
          { value: String(initialVersion), label: String(initialVersion) },
          ...(versions.data?.items
            .filter((item) => item.id !== initialVersion && item.status === 'published')
            .map((item) => ({
              value: String(item.id),
              label: String(item.number) + ' · ' + String(item.id)
            })) ?? [])
        ]}
        onValueChange={(selected) => {
          const item = versions.data?.items.find(
            (item) => String(item.id) === selected && item.status === 'published'
          );

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

      <CursorWindowActions
        {...window}
        hasMore={!!versions.data?.nextCursor}
        pending={versions.isFetching}
        more={() => window.more(versions.data?.nextCursor)}
      />
      <BlockPicker key={String(version)} pageId={pageId} version={version} onPick={onPick} />
    </div>
  );
}

function BlockPicker({
  pageId,
  version,
  onPick
}: {
  pageId: PageId;
  version: PageVersionId;
  onPick: (target: Target | undefined) => void;
}) {
  const { t } = useI18n();
  const [blockId, setBlockId] = useState('');
  const [preview, setPreview] = useState('');
  const state = useAnnotationPage(pageId, version);
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
            label={t('PageBlock')}
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
            <Field label={<> {t('PageSelectPassage')} </>}>
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
                  onPick(valid ? { pageId, range } : undefined);
                }}
              />
            </Field>
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
  const state = useRetainedRange(reference.target, open);
  const range = reference.target.range;

  return (
    <Disclosure
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      summary={<> {t('AnnotationOpenTarget')} </>}
    >
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
    </Disclosure>
  );
}
