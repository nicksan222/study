import type { StudyDocument } from '@study/contracts/documents/types';
import type { SourceId, SessionId, ContentSnapshotId } from '@study/contracts/ids';
import type { documentSchema, Source } from '@study/contracts/sources/schemas';
import { RetryButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { SessionDeskSurface as Desk } from '@study/ui/session-desk';
import { StatusMessage } from '@study/ui/status-message';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { RetainedDocumentReader, ContentReadError } from '../document-presentation';
import { SourceDeletion } from './deletion';
import { SourceHistory } from './history';
import { SourceHistoryRetirement } from './history-retirement';
import { sourceExportOptions } from './source-export.queries';
import { sourceExtractionOptions, sourceOptions, useSourceCopy } from './source-panel.queries';

function SourceHeader({
  source,
  error,
  retry,
  remove,
  retire
}: {
  source?: Source;
  error: unknown;
  retry: () => void;
  remove: () => void;
  retire: () => void;
}) {
  return (
    <>
      {source && <h1>{source.name}</h1>}
      {!!error && <ContentReadError error={error} retry={retry} />}
      {source && !error && (
        <>
          <SourceDeletion source={source} onDeleted={remove} />
          <SourceHistoryRetirement source={source} onRetired={retire} />
        </>
      )}
    </>
  );
}

function SourceOriginal({ sourceId, revision }: { sourceId: SourceId; revision?: bigint }) {
  const { t } = useI18n();
  const download = useMutation(sourceExportOptions(sourceId, revision));

  return (
    <>
      <Button variant="ghost" disabled={download.isPending} onClick={() => download.mutate()}>
        {t('ReaderOriginal')}
      </Button>
      {download.error && (
        <ErrorState
          title={t('ReaderOriginalUnavailable')}
          action={<RetryButton onClick={() => download.mutate()} label={t('Retry')} />}
        />
      )}
    </>
  );
}

function SourceBody({
  document,
  snapshotId,
  failed,
  pending,
  onCopy
}: {
  document?: typeof documentSchema.Type;
  snapshotId?: ContentSnapshotId;
  failed: boolean;
  pending: boolean;
  onCopy: () => void;
}) {
  const { t } = useI18n();

  if (failed) return null;

  if (!document || snapshotId === undefined) return <Loading label={t('SessionPending')} />;

  return (
    <Desk.Editor>
      <Button size="sm" variant="outline" disabled={pending} onClick={onCopy}>
        {t(pending ? 'SessionSaving' : 'DocumentEditCopy')}
      </Button>
      <RetainedDocumentReader document={document} snapshotId={snapshotId} />
    </Desk.Editor>
  );
}

function originalRevision(
  exact: { revision: bigint } | undefined,
  current: { revision: bigint } | null | undefined
) {
  return exact?.revision ?? current?.revision;
}

export function SourcePanel({
  sourceId,
  exact,
  sessionId,
  onOpenDocument,
  onDeleted
}: {
  sourceId: SourceId;
  exact?: { revision: bigint; snapshotId: ContentSnapshotId };
  sessionId?: SessionId;
  onOpenDocument: (document: StudyDocument) => void;
  onDeleted?: () => void;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState(exact);
  const [deleted, setDeleted] = useState(false);
  const source = useQuery(sourceOptions(deleted ? null : sourceId));
  const state = useQuery({ ...sourceExtractionOptions(sourceId, selected), enabled: !deleted });
  const copy = useSourceCopy(sourceId, sessionId);

  function editCopy() {
    if (!state.isSuccess || !source.isSuccess || !state.data) return;

    void copy.copy(state.data).then((document) => {
      if (document) onOpenDocument(document);
    });
  }

  if (deleted) return <StatusMessage>{t('SourceDeletedNotice')}</StatusMessage>;

  return (
    <>
      <SourceHeader
        source={source.data}
        error={source.error}
        retry={() => void source.refetch()}
        remove={() => {
          setDeleted(true);
          onDeleted?.();
        }}
        retire={() => setSelected(undefined)}
      />
      <SourceHistory sourceId={sourceId} onSelect={setSelected} />
      {state.error && <ContentReadError error={state.error} retry={() => void state.refetch()} />}
      <SourceOriginal sourceId={sourceId} revision={originalRevision(selected, state.data)} />
      {copy.document && (
        <Button variant="ghost" onClick={copy.acknowledge}>
          {t('DocumentEditAnotherCopy')}
        </Button>
      )}
      {copy.error !== undefined && <ContentReadError error={copy.error} retry={editCopy} />}
      <SourceBody
        document={state.data?.document}
        snapshotId={state.data?.snapshotId}
        failed={!state.isSuccess || !source.isSuccess}
        pending={copy.pending}
        onCopy={editCopy}
      />
    </>
  );
}
