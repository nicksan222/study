import type { SourceId, ContentSnapshotId, Page, documentSchema, Source } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { CopyIcon, OptionsIcon, DeleteIcon, InfoIcon } from '@study/icons';
import {
  IconButton,
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
import { useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import {
  RetainedDocumentPreview,
  ContentReadError,
  DocumentOmissions
} from '../document-presentation';
import { SourceDeletion } from './deletion';
import { ExtractionSummary } from './extraction-job-view';
import { SourceHistory } from './history';
import { SourceHistoryRetirement } from './history-retirement';
import { EditSourceButton } from './inline-source-editor';
import { OriginalDownload } from './original-download';
import { isFileOnlyMaterial, SourceAttachmentView } from './source-attachment-view';
import { useSourceExtraction, useExtractionJob, useSourceCopy } from './source-panel.queries';

function SourceManagement({
  source,
  remove,
  retire,
  container
}: {
  source: Source | null | undefined;
  remove: () => void;
  retire: () => void;
  container: HTMLDivElement | null;
}) {
  const { t } = useI18n();

  if (!source) return null;

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

function SourceBody({
  document,
  snapshotId
}: {
  document?: typeof documentSchema.Type;
  snapshotId?: ContentSnapshotId;
}) {
  if (!document || snapshotId === undefined) return null;

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

function SourceHistoryActions({
  sourceId,
  selected,
  document,
  inMaterials,
  onSelect
}: {
  sourceId: SourceId;
  selected?: { revision: bigint; snapshotId: ContentSnapshotId };
  document?: typeof documentSchema.Type;
  inMaterials: boolean;
  onSelect: (exact: { revision: bigint; snapshotId: ContentSnapshotId } | undefined) => void;
}) {
  return (
    <>
      <SourceHistory sourceId={sourceId} selected={selected} onSelect={onSelect} />
      {(!inMaterials || selected) && <SourceExtractionNotes document={document} />}
    </>
  );
}

function SourceToolbar({
  sourceId,
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
  const fileOnly = inMaterials && !selected && isFileOnlyMaterial(source.data, extraction.data);

  return (
    <SourceReader.Header>
      {source.data && <SourceReader.Title>{source.data.name}</SourceReader.Title>}
      <SourceReader.Actions ref={setMenuContainer}>
        <OriginalDownload sourceId={sourceId} revision={downloadRevision} withLabel={fileOnly} />
        <MaterialEditAction source={source.data} pinned={!!selected} inMaterials={inMaterials} />
        {extraction.data && source.data && (
          <CopySourceAction copy={copy} inMaterials={inMaterials} onCopy={onCopy} />
        )}
        {!fileOnly && (
          <SourceHistoryActions
            sourceId={sourceId}
            selected={selected}
            document={extraction.data?.document}
            inMaterials={inMaterials}
            onSelect={onSelect}
          />
        )}
        <SourceManagement
          source={source.error ? undefined : source.data}
          container={menuContainer}
          remove={onDeleted}
          retire={() => onSelect(undefined)}
        />
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
  source,
  extraction
}: {
  source: ReturnType<typeof rpc.sources.get.useQuery>;
  extraction: ReturnType<typeof useSourceExtraction>;
}) {
  return (
    <>
      {(source.isPending || extraction.isPending) && <SourceReaderLoading />}
      <SourceReadErrors source={source} extraction={extraction} />
      <SourceBody document={extraction.data?.document} snapshotId={extraction.data?.snapshotId} />
    </>
  );
}

function shouldShowExtractionJob(
  extraction: ReturnType<typeof useSourceExtraction>,
  pinned: boolean,
  inMaterials: boolean
) {
  return !pinned && (inMaterials || (extraction.isSuccess && !extraction.data));
}

function SourcePanelView({
  sourceId,
  source,
  extraction,
  inMaterials,
  pinned,
  copyError,
  onCopy
}: {
  sourceId: SourceId;
  source: ReturnType<typeof rpc.sources.get.useQuery>;
  extraction: ReturnType<typeof useSourceExtraction>;
  inMaterials: boolean;
  pinned: boolean;
  copyError: unknown;
  onCopy: () => void;
}) {
  const content = <SourcePanelContent source={source} extraction={extraction} />;
  const showJob = shouldShowExtractionJob(extraction, pinned, inMaterials);
  const job = useExtractionJob(sourceId, source.data, showJob);

  return (
    <>
      {copyError !== undefined && <ContentReadError error={copyError} retry={onCopy} />}
      {source.data ? (
        <SourceAttachmentView
          source={source.data}
          pinned={pinned}
          inMaterials={inMaterials}
          job={showJob && inMaterials ? job : undefined}
          extraction={extraction.data}
        >
          {showJob && !inMaterials && (
            <ExtractionSummary sourceId={sourceId} job={job} allowRetry={false} />
          )}
          {content}
        </SourceAttachmentView>
      ) : (
        content
      )}
    </>
  );
}

export function SourcePanel({
  sourceId,
  exact,
  presentation,
  onOpenPage,
  onDeleted
}: {
  sourceId: SourceId;
  exact?: { revision: bigint; snapshotId: ContentSnapshotId };
  presentation?: 'materials';
  onOpenPage: (page: Page) => void;
  onDeleted?: () => void;
}) {
  const { t } = useI18n();

  const [selected, setSelected] = useState(exact);

  const [deleted, setDeleted] = useState(false);

  const source = rpc.sources.get.useQuery(deleted ? undefined : { id: sourceId });

  const state = useSourceExtraction(sourceId, selected, !deleted);

  const copy = useSourceCopy(sourceId);
  const inMaterials = presentation === 'materials';
  const openCopy = () => void copy.open(state.data, onOpenPage);

  if (deleted) return <StatusMessage>{t('SourceDeletedNotice')}</StatusMessage>;

  return (
    <SourceReader.Root
      data-materials-reader={inMaterials || undefined}
      data-source-kind={source.data?.kind}
    >
      <SourceToolbar
        sourceId={sourceId}
        source={source}
        extraction={state}
        copy={copy}
        inMaterials={inMaterials}
        selected={selected}
        downloadRevision={originalRevision(selected, state.data, source.data?.kind, inMaterials)}
        onSelect={setSelected}
        onCopy={openCopy}
        onDeleted={() => {
          setDeleted(true);
          onDeleted?.();
        }}
      />
      <SourcePanelView
        sourceId={sourceId}
        source={source}
        extraction={state}
        inMaterials={inMaterials}
        pinned={!!selected}
        copyError={copy.error}
        onCopy={openCopy}
      />
    </SourceReader.Root>
  );
}
