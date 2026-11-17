import type {
  SourceId,
  NoteId,
  ContentSnapshotId,
  Page,
  documentSchema,
  Source
} from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { DownloadIcon, EditIcon, OptionsIcon, DeleteIcon, InfoIcon } from '@study/icons';
import {
  RetryButton,
  Button,
  IconButton,
  ErrorState,
  Loading,
  SourceContent,
  SourceReader,
  StatusMessage,
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuItem,
  MenuSeparator,
  Dialog,
  DialogTrigger,
  DialogHeading
} from '@study/ui';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import {
  RetainedDocumentPreview,
  ContentReadError,
  DocumentOmissions
} from '../document-presentation';
import { SourceDeletion } from './deletion';
import { SourceHistory } from './history';
import { SourceHistoryRetirement } from './history-retirement';
import { useSourceExport } from './source-export.queries';
import {
  useSourceExtraction,
  useSourceProcessingExecution,
  useSourceCopy
} from './source-panel.queries';

function SourceManagement({
  source,
  remove,
  retire,
  container
}: {
  source: Source;
  remove: () => void;
  retire: () => void;
  container: HTMLDivElement | null;
}) {
  const { t } = useI18n();

  return (
    <SourceDeletion
      source={source}
      onDeleted={remove}
      renderTrigger={(showDelete) => (
        <SourceHistoryRetirement
          source={source}
          onRetired={retire}
          renderTrigger={(showRetire) => (
            <Menu>
              <MenuTrigger render={<IconButton size="icon-sm" label={t('MediaActions')} />}>
                <OptionsIcon aria-hidden="true" />
              </MenuTrigger>
              <MenuPopup align="end" portalProps={{ container }}>
                <MenuItem onClick={showRetire}>{t('SourceHistoryPrune')}</MenuItem>
                <MenuSeparator />
                <MenuItem variant="destructive" onClick={showDelete}>
                  <DeleteIcon aria-hidden="true" />
                  {t('SourceDeleteTitle')}
                </MenuItem>
              </MenuPopup>
            </Menu>
          )}
        />
      )}
    />
  );
}

function SourceOriginal({ sourceId, revision }: { sourceId: SourceId; revision?: bigint }) {
  const { t } = useI18n();

  const download = useSourceExport(sourceId, revision);

  return (
    <>
      <IconButton
        size="icon-sm"
        label={t('ReaderOriginal')}
        disabled={download.pending > 0}
        onClick={() => void download.mutate(undefined)}
      >
        <DownloadIcon aria-hidden="true" />
      </IconButton>
      {download.error && (
        <ErrorState
          title={t('ReaderOriginalUnavailable')}
          action={
            <RetryButton onClick={() => void download.mutate(undefined)} label={t('Retry')} />
          }
        />
      )}
    </>
  );
}

function SourceProcessingOutcome({ sourceId }: { sourceId: SourceId }) {
  const { t } = useI18n();

  const state = useSourceProcessingExecution(sourceId);

  if (state.error)
    return <ContentReadError error={state.error} retry={() => void state.refetch()} />;

  const execution = state.data;

  if (execution?.outcome === 'failure')
    return (
      <StatusMessage>
        {t(
          execution.failureKind === 'unsupported'
            ? 'SourceExtractionUnsupported'
            : 'SourceExtractionFailed'
        )}
      </StatusMessage>
    );

  const reason = execution?.configurationWaitReason;

  if (reason)
    return (
      <div>
        <StatusMessage>
          {t(
            reason === 'auth'
              ? 'NoteWaitAuth'
              : reason === 'config'
                ? 'NoteWaitConfig'
                : 'NoteWaitModel'
          )}
        </StatusMessage>
        <Button variant="ghost" render={<Link to="/settings" />}>
          {t('Settings')}
        </Button>
      </div>
    );

  return <Loading label={t('NotePending')} />;
}

function SourceBody({
  sourceId,
  document,
  snapshotId,
  failed
}: {
  sourceId?: SourceId;
  document?: typeof documentSchema.Type;
  snapshotId?: ContentSnapshotId;
  failed: boolean;
}) {
  const { t } = useI18n();

  if (failed) return null;

  if (!document || snapshotId === undefined)
    return sourceId ? (
      <SourceProcessingOutcome sourceId={sourceId} />
    ) : (
      <Loading label={t('NotePending')} />
    );

  return (
    <SourceContent>
      <RetainedDocumentPreview document={document} snapshotId={snapshotId} />
    </SourceContent>
  );
}

function originalRevision(
  exact: { revision: bigint } | undefined,
  current: { revision: bigint } | null | undefined
) {
  return exact?.revision ?? current?.revision;
}

function SourceExtractionNotes({ document }: { document?: typeof documentSchema.Type }) {
  const { t } = useI18n();

  if (!document?.meta.omissions.length) return null;

  return (
    <Dialog>
      <DialogTrigger render={<IconButton size="icon-sm" label={t('ReaderExtractionNotes')} />}>
        <InfoIcon aria-hidden="true" />
      </DialogTrigger>
      <SourceReader.DetailsPopup closeLabel={t('Close')}>
        <DialogHeading title={t('ReaderExtractionNotes')} />
        <SourceReader.Notes>
          <DocumentOmissions document={document} />
        </SourceReader.Notes>
      </SourceReader.DetailsPopup>
    </Dialog>
  );
}

function SourceToolbar({
  sourceId,
  noteId,
  source,
  extraction,
  copy,
  selected,
  onSelect,
  onCopy,
  onDeleted
}: {
  sourceId: SourceId;
  noteId?: NoteId;
  source: ReturnType<typeof rpc.sources.get.useQuery>;
  extraction: ReturnType<typeof useSourceExtraction>;
  copy: ReturnType<typeof useSourceCopy>;
  selected?: { revision: bigint; snapshotId: ContentSnapshotId };
  onSelect: (exact: { revision: bigint; snapshotId: ContentSnapshotId } | undefined) => void;
  onCopy: () => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const [menuContainer, setMenuContainer] = useState<HTMLDivElement | null>(null);

  return (
    <SourceReader.Header>
      {!noteId && source.data && <SourceReader.Title>{source.data.name}</SourceReader.Title>}
      <SourceReader.Actions ref={setMenuContainer}>
        <SourceOriginal
          sourceId={sourceId}
          revision={originalRevision(selected, extraction.data)}
        />
        {extraction.isSuccess && extraction.data && source.isSuccess && (
          <IconButton
            size="icon-sm"
            label={t(copy.pending ? 'NoteSaving' : 'PageEditCopy')}
            disabled={copy.pending}
            onClick={onCopy}
          >
            <EditIcon aria-hidden="true" />
          </IconButton>
        )}
        <SourceHistory sourceId={sourceId} selected={selected} onSelect={onSelect} />
        <SourceExtractionNotes document={extraction.data?.document} />
        {source.data && !source.error && (
          <SourceManagement
            source={source.data}
            container={menuContainer}
            remove={onDeleted}
            retire={() => onSelect(undefined)}
          />
        )}
      </SourceReader.Actions>
    </SourceReader.Header>
  );
}

function SourceReadErrors({
  source,
  extraction
}: {
  source: ReturnType<typeof rpc.sources.get.useQuery>;
  extraction: ReturnType<typeof useSourceExtraction>;
}) {
  return (
    <>
      {source.error && (
        <ContentReadError error={source.error} retry={() => void source.refetch()} />
      )}
      {extraction.error && (
        <ContentReadError error={extraction.error} retry={() => void extraction.refetch()} />
      )}
    </>
  );
}

export function SourcePanel({
  sourceId,
  exact,
  noteId,
  onOpenPage,
  onDeleted
}: {
  sourceId: SourceId;
  exact?: { revision: bigint; snapshotId: ContentSnapshotId };
  noteId?: NoteId;
  onOpenPage: (page: Page) => void;
  onDeleted?: () => void;
}) {
  const { t } = useI18n();

  const [selected, setSelected] = useState(exact);

  const [deleted, setDeleted] = useState(false);

  const source = rpc.sources.get.useQuery(deleted ? undefined : { id: sourceId });

  const state = useSourceExtraction(sourceId, selected, !deleted);

  const copy = useSourceCopy(sourceId, noteId);

  function editCopy() {
    if (!state.isSuccess || !source.isSuccess || !state.data) return;

    void copy.copy(state.data).then((page) => {
      if (page) onOpenPage(page);
    });
  }

  if (deleted) return <StatusMessage>{t('SourceDeletedNotice')}</StatusMessage>;

  return (
    <SourceReader.Root>
      <SourceToolbar
        sourceId={sourceId}
        noteId={noteId}
        source={source}
        extraction={state}
        copy={copy}
        selected={selected}
        onSelect={setSelected}
        onCopy={editCopy}
        onDeleted={() => {
          setDeleted(true);
          onDeleted?.();
        }}
      />
      <SourceReadErrors source={source} extraction={state} />
      {copy.page && (
        <Button variant="ghost" onClick={copy.acknowledge}>
          {t('PageEditAnotherCopy')}
        </Button>
      )}
      {copy.error !== undefined && <ContentReadError error={copy.error} retry={editCopy} />}
      <SourceBody
        sourceId={selected ? undefined : sourceId}
        document={state.data?.document}
        snapshotId={state.data?.snapshotId}
        failed={!state.isSuccess || !source.isSuccess}
      />
    </SourceReader.Root>
  );
}
