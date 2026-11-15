import type { PageVersionId } from '@study/contracts/ids';
import type { PageSummary } from '@study/contracts/pages/types';
import { rpc } from '@study/contracts/react';
import { Button } from '@study/ui/button';
import type { ItemDeletionActions } from '@study/ui/context-menu';
import { DangerDialog } from '@study/ui/danger-dialog';
import { Loading } from '@study/ui/loading';
import { VersionDeletionList } from '@study/ui/version-deletion-list';
import { useState } from 'react';
import type { ReactNode } from 'react';

import {
  CursorWindowActions,
  useCursorRecovery,
  useCursorWindow
} from '#client/lib/cursor-window.tsx';
import { useNativeAction } from '#client/lib/effect/native.ts';
import { useI18n } from '#client/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation';

/** Notebook actions keep whole-page deletion separate from one exact historical body. */
export function PageNotebookDeletion({
  page,
  onDeleted,
  renderActions
}: {
  page: PageSummary;
  onDeleted?: () => void;
  renderActions?: (actions: ItemDeletionActions) => ReactNode;
}) {
  const { t } = useI18n();
  const model = usePageNotebookDeletion(page, onDeleted);
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
  const { page, mode, confirming, selectedVersion, versionId, preview } = model;
  const label = t(mode === 'item' ? 'NoteDeleteItem' : 'NoteDeleteVersion');
  const title = mode === 'version' && !confirming ? t('NoteDeleteChooseVersion') : label;
  let description = page.title;

  if (mode === 'item') description = t('NoteDeleteItemHelp');
  else if (confirming)
    description = t('NoteDeleteChosenVersionHelp', {
      version: t('ReaderVersion') + ' ' + String(selectedVersion?.number),
      name: page.title
    });

  const confirmation = confirming
    ? {
        identity:
          String(page.id) + ':' + mode + ':' + String(versionId) + ':' + preview.data?.token,
        value: page.title,
        label: t('DeleteConfirmationInstruction', { word: page.title })
      }
    : null;

  return { label, title, description, confirmation };
}

function usePageNotebookDeletion(page: PageSummary, onDeleted?: () => void) {
  const [mode, setMode] = useState<'item' | 'version'>();
  const [versionId, setVersionId] = useState<PageVersionId>();
  const pagination = useCursorWindow<PageVersionId>(String(page.id));
  const historyQuery = rpc.pages.versions.useQuery(
    { pageId: page.id, limit: pagination.limit, cursor: pagination.cursor },
    { enabled: mode === 'version' }
  );
  const history = {
    ...historyQuery,
    hasNextPage: !!historyQuery.data?.nextCursor,
    pagination,
    isFetchingNextPage: historyQuery.isFetching,
    fetchNextPage: () => pagination.more(historyQuery.data?.nextCursor)
  };

  useCursorRecovery(pagination, historyQuery.error);
  const whole = rpc.pages.previewDeletion.useQuery({ id: page.id }, { enabled: mode === 'item' });
  const exact = rpc.pages.previewHistory.useQuery(
    { pageId: page.id, keepLatest: 1, versionId },
    { enabled: mode === 'version' && versionId !== undefined }
  );
  const preview = mode === 'item' ? whole : exact;
  const removeAction = useNativeAction(async () => {
    const token = preview.data?.token;

    if (!token) return;

    if (mode === 'item') await rpc.pages.delete.call({ pageId: page.id, token });
    else await rpc.pages.retireHistory.call({ pageId: page.id, keepLatest: 1, versionId, token });

    setMode(undefined);

    if (mode === 'item') onDeleted?.();
  });
  const remove = {
    ...removeAction,
    mutate: () => {
      void removeAction.mutateAsync(undefined).catch(() => {});
    }
  };
  const blocked =
    !preview.data ||
    !!preview.data.blockedVersionIds.length ||
    (mode === 'version' && !preview.data.versionIds.length);
  const confirming = preview.isSuccess && !preview.isFetching && !blocked && !remove.isError;
  const selectedVersion = history.data?.items.find((version) => version.id === versionId);

  function open(next: 'item' | 'version') {
    remove.reset();
    setVersionId(undefined);
    setMode(next);
  }

  return {
    page,
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
  const { page, versionId, setVersionId, history, preview } = model;
  const versions = history.data?.items ?? [];

  return (
    <>
      {history.isPending && <Loading label={t('LoadingStudy')} />}
      <VersionDeletionList
        items={versions.map((version) => ({
          id: version.id,
          label: t('ReaderVersion') + ' ' + String(version.number),
          description: date(version.createdAt),
          disabled: version.id === page.headVersionId,
          status: version.id === page.headVersionId ? t('ReaderCurrent') : undefined
        }))}
        selected={versionId}
        pending={preview.isFetching}
        pendingLabel={t('LoadingStudy')}
        onSelect={setVersionId}
      />
      {versions.length === 1 && !history.hasNextPage && !history.pagination.hasPrevious && (
        <p>{t('NoteDeleteNoOlderVersions')}</p>
      )}
      <CursorWindowActions
        {...history.pagination}
        hasMore={history.hasNextPage}
        pending={history.isFetching || preview.isFetching}
        previous={() => {
          setVersionId(undefined);
          history.pagination.previous();
        }}
        more={() => {
          setVersionId(undefined);
          history.fetchNextPage();
        }}
      />
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
