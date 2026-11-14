import type { ContentSnapshotId } from '@study/contracts/ids';
import type { Source } from '@study/contracts/sources/schemas';
import { Button } from '@study/ui/button';
import { DangerDialog } from '@study/ui/danger-dialog';
import { Loading } from '@study/ui/loading';
import { VersionDeletionList } from '@study/ui/version-deletion-list';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { CursorWindowActions } from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation';
import { useSourceHistoryRetirement } from './history-retirement.queries';
import { useSourceHistory } from './history.queries';

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
          {t('NoteDeleteVersion')}
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
      title={t(confirming ? 'NoteDeleteVersion' : 'NoteDeleteChooseVersion')}
      description={
        confirming
          ? t('NoteDeleteChosenVersionHelp', {
              version: t('ReaderVersion') + ' ' + String(selectedVersion?.revision),
              name: source.name
            })
          : source.name
      }
      confirmLabel={t('NoteDeleteVersion')}
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
  const history = useSourceHistory(source.id, view.open);
  const preview = view.preview;
  const blocked =
    selected === undefined ||
    !preview.data?.candidates.length ||
    !!preview.data?.blockedSnapshotIds.length;
  const pending = view.pending;

  const confirming = selected !== undefined && preview.isSuccess && !preview.isFetching && !blocked;
  const selectedVersion = history.data?.items.find((version) => version.snapshotId === selected);

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
  const { selected, setSelected, history, pending } = model;
  const choices = sourceVersionChoices(model);

  return (
    <>
      {history.isPending && <Loading label={t('LoadingStudy')} />}
      <VersionDeletionList
        items={sourceVersionRows(choices.versions, choices.latest, t, date)}
        selected={selected}
        pending={choices.pending}
        pendingLabel={t('LoadingStudy')}
        onSelect={setSelected}
      />
      {choices.noOlderVersions && <p>{t('NoteDeleteNoOlderVersions')}</p>}

      <CursorWindowActions
        hasPrevious={history.hasPrevious}
        previous={history.previous}
        hasMore={!!history.data?.next}
        pending={history.isFetching || pending}
        more={history.loadMore}
      />
    </>
  );
}

function sourceVersionChoices(model: Model) {
  const versions = model.history.data?.items ?? [];

  return {
    versions,
    latest: model.history.hasPrevious ? undefined : versions[0]?.snapshotId,
    pending: model.pending || model.preview.isFetching || !!model.view.state.attempt,
    noOlderVersions: versions.length === 1 && !model.history.data?.next
  };
}

function sourceVersionRows(
  versions: NonNullable<Model['history']['data']>['items'],
  latest: ContentSnapshotId | undefined,
  t: ReturnType<typeof useI18n>['t'],
  date: ReturnType<typeof useI18n>['date']
) {
  return versions.map((version) => ({
    id: version.snapshotId,
    label: t('ReaderVersion') + ' ' + String(version.revision),
    description: date(version.createdAt),
    disabled: version.snapshotId === latest,
    status: version.snapshotId === latest ? t('NoteVersionLatest') : undefined
  }));
}

function SourceVersionFeedback({ model }: { model: Model }) {
  const { t } = useI18n();
  const { selected, view, history, preview, blocked, pending } = model;

  return (
    <>
      {' '}
      {selected !== undefined && preview.isSuccess && !preview.isFetching && blocked && (
        <p>{t('NoteDeleteVersionProtected')}</p>
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
