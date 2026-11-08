import type { PageVersionId } from '@study/contracts/ids';
import type { PageSummary } from '@study/contracts/pages/types';
import { LoadMoreButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import type { ItemDeletionActions } from '@study/ui/context-menu';
import { DangerDialog } from '@study/ui/danger-dialog';
import { Loading } from '@study/ui/loading';
import { VersionDeletionList } from '@study/ui/version-deletion-list';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { pageHistoryOptions, invalidatePages } from '#web/lib/study-client/pages.queries.ts';

import { ContentReadError, releaseBodyPreviews } from '../document-presentation';
import {
  notebookDeletionOptions,
  notebookDeletionPreviewOptions
} from './notebook-deletion.queries';

/** Notebook actions keep whole-document deletion separate from one exact historical body. */
export function PageNotebookDeletion({
  document,
  onDeleted,
  renderActions
}: {
  document: PageSummary;
  onDeleted?: () => void;
  renderActions?: (actions: ItemDeletionActions) => ReactNode;
}) {
  const { t } = useI18n();
  const model = usePageNotebookDeletion(document, onDeleted);
  const { mode, open } = model;

  return (
    <>
      {renderActions ? (
        renderActions({
          onDeleteItem: () => open('item'),
          onDeleteVersion: () => open('version'),
          open: mode !== undefined
        })
      ) : (
        <>
          <Button size="sm" variant="ghost-destructive" onClick={() => open('item')}>
            {t('NoteDeleteItem')}
          </Button>
          <Button size="sm" variant="ghost-destructive" onClick={() => open('version')}>
            {t('NoteDeleteVersion')}
          </Button>
        </>
      )}
      <PageDeletionDialog model={model} />
    </>
  );
}

function PageDeletionDialog({ model }: { model: Model }) {
  const { t } = useI18n();
  const { mode, setMode, preview, remove, blocked, confirming } = model;
  const copy = usePageDeletionCopy(model);

  return (
    <DangerDialog
      open={mode !== undefined}
      onOpenChange={(open) => {
        if (!open) setMode(undefined);
      }}
      title={copy.title}
      description={copy.description}
      confirmLabel={copy.label}
      cancelLabel={t('Cancel')}
      pending={remove.isPending}
      disabled={blocked || preview.isFetching || preview.isError || remove.isError}
      confirmation={copy.confirmation}
      onConfirm={() => remove.mutate()}
    >
      {mode === 'version' && !confirming && <PageVersionChoices model={model} />}
      {mode === 'item' && preview.isFetching && <Loading label={t('LoadingStudy')} />}
      <PageDeletionFeedback model={model} />
    </DangerDialog>
  );
}

function usePageDeletionCopy(model: Model) {
  const { t } = useI18n();
  const { document, mode, confirming, selectedVersion, versionId, preview } = model;
  const label = t(mode === 'item' ? 'NoteDeleteItem' : 'NoteDeleteVersion');
  const title = mode === 'version' && !confirming ? t('NoteDeleteChooseVersion') : label;
  let description = document.title;

  if (mode === 'item') description = t('NoteDeleteItemHelp');
  else if (confirming)
    description = t('NoteDeleteChosenVersionHelp', {
      version: t('ReaderVersion') + ' ' + String(selectedVersion?.number),
      name: document.title
    });

  const confirmation = confirming
    ? {
        identity:
          String(document.id) + ':' + mode + ':' + String(versionId) + ':' + preview.data?.token,
        value: document.title,
        label: t('DeleteConfirmationInstruction', { word: document.title })
      }
    : null;

  return { label, title, description, confirmation };
}

function usePageNotebookDeletion(document: PageSummary, onDeleted?: () => void) {
  const cache = useQueryClient();
  const [mode, setMode] = useState<'item' | 'version'>();
  const [versionId, setVersionId] = useState<PageVersionId>();
  const history = useInfiniteQuery({
    ...pageHistoryOptions(document.id),
    enabled: mode === 'version'
  });
  const preview = useQuery(
    notebookDeletionPreviewOptions({ pageId: document.id, mode, versionId })
  );
  const remove = useMutation({
    ...notebookDeletionOptions({
      pageId: document.id,
      mode,
      versionId,
      token: preview.data?.token
    }),
    onSuccess: async () => {
      if (!preview.data) return;

      await releaseBodyPreviews(cache, {
        kind: 'page',
        pageId: String(document.id),
        versionIds: preview.data.versionIds.map(String)
      });
      await invalidatePages(cache);
      setMode(undefined);

      if (mode === 'item') onDeleted?.();
    },
    onError: async () => {
      if (preview.data)
        await releaseBodyPreviews(cache, {
          kind: 'page',
          pageId: String(document.id),
          versionIds: preview.data.versionIds.map(String)
        });
    }
  });
  const blocked =
    !preview.data ||
    !!preview.data.blockedVersionIds.length ||
    (mode === 'version' && !preview.data.versionIds.length);
  const confirming = preview.isSuccess && !preview.isFetching && !blocked && !remove.isError;
  const selectedVersion = history.data?.pages
    .flatMap((page) => page.items)
    .find((version) => version.id === versionId);

  function open(next: 'item' | 'version') {
    remove.reset();
    setVersionId(undefined);
    setMode(next);
  }

  return {
    document,
    mode,
    setMode,
    versionId,
    setVersionId,
    history,
    preview,
    remove,
    blocked,
    open,
    confirming,
    selectedVersion
  };
}

type Model = ReturnType<typeof usePageNotebookDeletion>;

function PageVersionChoices({ model }: { model: Model }) {
  const { t, date } = useI18n();
  const { document, versionId, setVersionId, history, preview } = model;
  const versions = history.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      {history.isPending && <Loading label={t('LoadingStudy')} />}
      <VersionDeletionList
        items={versions.map((version) => ({
          id: version.id,
          label: t('ReaderVersion') + ' ' + String(version.number),
          description: date(version.createdAt),
          disabled: version.id === document.headVersionId,
          status: version.id === document.headVersionId ? t('ReaderCurrent') : undefined
        }))}
        selected={versionId}
        pending={preview.isFetching}
        pendingLabel={t('LoadingStudy')}
        onSelect={setVersionId}
      />
      {versions.length === 1 && !history.hasNextPage && <p>{t('NoteDeleteNoOlderVersions')}</p>}
      {history.hasNextPage && (
        <LoadMoreButton
          disabled={history.isFetchingNextPage || preview.isFetching}
          onClick={() => void history.fetchNextPage()}
          label={t('LibraryMore')}
        />
      )}
    </>
  );
}

function PageDeletionFeedback({ model }: { model: Model }) {
  const { t } = useI18n();
  const { mode, history, preview, remove, blocked } = model;

  return (
    <>
      {' '}
      {model.versionId !== undefined && preview.isSuccess && !preview.isFetching && blocked && (
        <p>{t('NoteDeleteVersionProtected')}</p>
      )}
      {history.error && mode === 'version' && (
        <ContentReadError error={history.error} retry={() => void history.refetch()} />
      )}
      {(preview.error || remove.error) && (
        <ContentReadError
          error={preview.error || remove.error}
          retry={() => {
            remove.reset();
            void preview.refetch();
          }}
        />
      )}
    </>
  );
}
