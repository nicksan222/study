import type { ContentSnapshotId } from '@study/contracts/ids';
import type { Source } from '@study/contracts/sources/schemas';
import { LoadMoreButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { DangerDialog } from '@study/ui/danger-dialog';
import { Loading } from '@study/ui/loading';
import { VersionDeletionList } from '@study/ui/version-deletion-list';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation';
import { useSourceHistoryRetirement } from './history-retirement.queries';
import { sourceHistoryOptions } from './history.queries';

/** Removes one reviewed extraction through the existing source history service. */
export function SourceVersionDeletion({
  source,
  onDeleted,
  renderTrigger
}: {
  source: Source;
  onDeleted: () => void;
  renderTrigger?: (show: () => void, open: boolean) => ReactNode;
}) {
  const { t } = useI18n();
  const model = useSourceVersionDeletion(source, onDeleted);
  const { setSelected, view } = model;

  return (
    <>
      {renderTrigger ? (
        renderTrigger(() => {
          setSelected(undefined);
          view.show();
        }, view.open)
      ) : (
        <Button
          variant="ghost-destructive"
          size="sm"
          onClick={() => {
            setSelected(undefined);
            view.show();
          }}
        >
          {t('SessionDeleteVersion')}
        </Button>
      )}
      <SourceVersionDialog model={model} source={source} />
    </>
  );
}

function SourceVersionDialog({ model, source }: { model: Model; source: Source }) {
  const { t } = useI18n();
  const { selected, view, preview, blocked, pending, confirming, selectedVersion } = model;

  return (
    <DangerDialog
      open={view.open}
      onOpenChange={view.setOpen}
      title={t(confirming ? 'SessionDeleteVersion' : 'SessionDeleteChooseVersion')}
      description={
        confirming
          ? t('SessionDeleteChosenVersionHelp', {
              version: t('ReaderVersion') + ' ' + String(selectedVersion?.revision),
              name: source.name
            })
          : source.name
      }
      confirmLabel={t('SessionDeleteVersion')}
      cancelLabel={t('Cancel')}
      pending={pending}
      disabled={blocked || preview.isFetching || preview.isError || !!view.state.attempt}
      confirmation={
        confirming
          ? {
              identity: String(source.id) + ':' + String(selected) + ':' + preview.data?.token,
              value: source.name,
              label: t('DeleteConfirmationInstruction', { word: source.name })
            }
          : null
      }
      onConfirm={view.confirm}
    >
      {!confirming && <SourceVersionChoices model={model} />}
      <SourceVersionFeedback model={model} />
    </DangerDialog>
  );
}

function useSourceVersionDeletion(source: Source, onDeleted: () => void) {
  const [selected, setSelected] = useState<ContentSnapshotId>();
  const view = useSourceHistoryRetirement(source.id, onDeleted, selected ?? null);
  const history = useInfiniteQuery(sourceHistoryOptions(source.id, view.open));
  const preview = view.preview;
  const blocked =
    selected === undefined ||
    !preview.data?.candidates.length ||
    !!preview.data?.blockedSnapshotIds.length;
  const pending = view.pending;

  const confirming = selected !== undefined && preview.isSuccess && !preview.isFetching && !blocked;
  const selectedVersion = history.data?.pages
    .flatMap((page) => page.items)
    .find((version) => version.snapshotId === selected);

  return {
    selected,
    setSelected,
    view,
    history,
    preview,
    blocked,
    pending,
    confirming,
    selectedVersion
  };
}

type Model = ReturnType<typeof useSourceVersionDeletion>;

function SourceVersionChoices({ model }: { model: Model }) {
  const { t, date } = useI18n();
  const { selected, setSelected, view, history, preview, pending } = model;
  const versions = history.data?.pages.flatMap((page) => page.items) ?? [];
  const latest = versions[0]?.snapshotId;

  return (
    <>
      {history.isPending && <Loading label={t('LoadingStudy')} />}
      <VersionDeletionList
        items={versions.map((version) => ({
          id: version.snapshotId,
          label: t('ReaderVersion') + ' ' + String(version.revision),
          description: date(version.createdAt),
          disabled: version.snapshotId === latest,
          status: version.snapshotId === latest ? t('SessionVersionLatest') : undefined
        }))}
        selected={selected}
        pending={pending || preview.isFetching || !!view.state.attempt}
        pendingLabel={t('LoadingStudy')}
        onSelect={setSelected}
      />
      {versions.length === 1 && !history.hasNextPage && <p>{t('SessionDeleteNoOlderVersions')}</p>}
      {history.hasNextPage && (
        <LoadMoreButton
          disabled={history.isFetchingNextPage || pending}
          onClick={() => void history.fetchNextPage()}
          label={t('LibraryMore')}
        />
      )}
    </>
  );
}

function SourceVersionFeedback({ model }: { model: Model }) {
  const { t } = useI18n();
  const { selected, view, history, preview, blocked, pending } = model;

  return (
    <>
      {' '}
      {selected !== undefined && preview.isSuccess && !preview.isFetching && blocked && (
        <p>{t('SessionDeleteVersionProtected')}</p>
      )}
      {history.error && (
        <ContentReadError error={history.error} retry={() => void history.refetch()} />
      )}
      {preview.error && (
        <ContentReadError error={preview.error} retry={() => void preview.refetch()} />
      )}
      {view.remove.error && <ContentReadError error={view.remove.error} retry={view.reviewAgain} />}
      {view.state.attempt && (
        <Button disabled={pending} onClick={() => view.recover.mutate()}>
          {t('SourceHistoryRecover')}
        </Button>
      )}
      {view.recover.error && (
        <ContentReadError error={view.recover.error} retry={() => view.recover.mutate()} />
      )}
    </>
  );
}
