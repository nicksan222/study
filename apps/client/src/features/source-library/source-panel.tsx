import type {
  SourceId,
  NoteId,
  ContentSnapshotId,
  Page,
  documentSchema,
  Source
} from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { DownloadIcon, CopyIcon, OptionsIcon, DeleteIcon, InfoIcon } from '@study/icons';
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
import { EditSourceButton } from './inline-source-editor';
import { SourceAttachmentView } from './source-attachment-view';
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
  current: { revision: bigint } | null | undefined,
  kind: Source['kind'] | undefined,
  inMaterials: boolean
) {
  return exact?.revision ?? (inMaterials || kind === 'pdf' ? undefined : current?.revision);
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

function CopySourceAction({
  copy,
  inMaterials,
  onCopy
}: {
  copy: ReturnType<typeof useSourceCopy>;
  inMaterials: boolean;
  onCopy: () => void;
}) {
  const { t } = useI18n();
  const label = copy.page
    ? 'PageEditAnotherCopy'
    : inMaterials
      ? 'MaterialCopyToPages'
      : 'PageEditCopy';

  function openCopy() {
    if (copy.page) copy.acknowledge();

    onCopy();
  }

  return (
    <IconButton size="icon-sm" label={t(label)} disabled={copy.pending} onClick={openCopy}>
      <CopyIcon aria-hidden="true" />
    </IconButton>
  );
}

function MaterialEditAction({
  source,
  pinned,
  inMaterials
}: {
  source: Source | null | undefined;
  pinned: boolean;
  inMaterials: boolean;
}) {
  return inMaterials && !pinned && source?.kind === 'text' ? (
    <EditSourceButton source={source} />
  ) : null;
}

function SourceToolbar({
  sourceId,
  noteId,
  source,
  extraction,
  copy,
  selected,
  downloadRevision,
  onSelect,
  onCopy,
  inMaterials,
  onDeleted
}: {
  sourceId: SourceId;
  noteId?: NoteId;
  source: ReturnType<typeof rpc.sources.get.useQuery>;
  extraction: ReturnType<typeof useSourceExtraction>;
  copy: ReturnType<typeof useSourceCopy>;
  selected?: { revision: bigint; snapshotId: ContentSnapshotId };
  downloadRevision?: bigint;
  onSelect: (exact: { revision: bigint; snapshotId: ContentSnapshotId } | undefined) => void;
  onCopy: () => void;
  inMaterials: boolean;
  onDeleted: () => void;
}) {
  const [menuContainer, setMenuContainer] = useState<HTMLDivElement | null>(null);

  return (
    <SourceReader.Header>
      {!noteId && source.data && <SourceReader.Title>{source.data.name}</SourceReader.Title>}
      <SourceReader.Actions ref={setMenuContainer}>
        <SourceOriginal sourceId={sourceId} revision={downloadRevision} />
        <MaterialEditAction source={source.data} pinned={!!selected} inMaterials={inMaterials} />
        {extraction.data && source.data && (
          <CopySourceAction copy={copy} inMaterials={inMaterials} onCopy={onCopy} />
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

function SourceReaderLoading() {
  const { t } = useI18n();

  return <Loading label={t('LoadingStudy')} />;
}

function SourcePanelContent({
  sourceId,
  source,
  extraction,
  pinned
}: {
  sourceId: SourceId;
  source: ReturnType<typeof rpc.sources.get.useQuery>;
  extraction: ReturnType<typeof useSourceExtraction>;
  pinned: boolean;
}) {
  return (
    <>
      {(source.isPending || extraction.isPending) && <SourceReaderLoading />}
      <SourceReadErrors source={source} extraction={extraction} />
      <SourceBody
        sourceId={pinned ? undefined : sourceId}
        document={extraction.data?.document}
        snapshotId={extraction.data?.snapshotId}
        failed={!extraction.isSuccess || !source.isSuccess}
      />
    </>
  );
}

export function SourcePanel({
  sourceId,
  exact,
  noteId,
  presentation,
  onOpenPage,
  onDeleted
}: {
  sourceId: SourceId;
  exact?: { revision: bigint; snapshotId: ContentSnapshotId };
  noteId?: NoteId;
  presentation?: 'materials';
  onOpenPage: (page: Page) => void;
  onDeleted?: () => void;
}) {
  const { t } = useI18n();

  const [selected, setSelected] = useState(exact);

  const [deleted, setDeleted] = useState(false);

  const source = rpc.sources.get.useQuery(deleted ? undefined : { id: sourceId });

  const state = useSourceExtraction(sourceId, selected, !deleted);

  const copy = useSourceCopy(sourceId, noteId);

  const mode = presentation ?? (noteId ? 'note' : 'citation');
  const extraction = (
    <SourcePanelContent
      sourceId={sourceId}
      source={source}
      extraction={state}
      pinned={!!selected}
    />
  );

  if (deleted) return <StatusMessage>{t('SourceDeletedNotice')}</StatusMessage>;

  return (
    <SourceReader.Root data-materials-reader={presentation === 'materials' || undefined}>
      <SourceToolbar
        sourceId={sourceId}
        noteId={noteId}
        source={source}
        extraction={state}
        copy={copy}
        inMaterials={presentation === 'materials'}
        selected={selected}
        downloadRevision={originalRevision(
          selected,
          state.data,
          source.data?.kind,
          mode === 'materials'
        )}
        onSelect={setSelected}
        onCopy={() => void copy.open(state.data, onOpenPage)}
        onDeleted={() => {
          setDeleted(true);
          onDeleted?.();
        }}
      />
      {copy.error !== undefined && (
        <ContentReadError error={copy.error} retry={() => void copy.open(state.data, onOpenPage)} />
      )}
      {source.data ? (
        <SourceAttachmentView
          source={source.data}
          pinned={!!selected}
          mode={mode}
          extraction={state.data}
        >
          {extraction}
        </SourceAttachmentView>
      ) : (
        extraction
      )}
    </SourceReader.Root>
  );
}
