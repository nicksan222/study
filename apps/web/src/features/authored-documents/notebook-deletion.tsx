import type { StudyDocumentSummary } from '@study/contracts/documents/types';
import type { StudyDocumentVersionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { DangerDialog } from '@study/ui/danger-dialog';
import { Loading } from '@study/ui/loading';
import { VersionDeletionList } from '@study/ui/version-deletion-list';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import {
  documentHistoryOptions,
  invalidateDocuments
} from '#web/lib/study-client/documents.queries.ts';
import { request } from '#web/lib/study-client/request.ts';

import { ContentReadError, releaseBodyPreviews } from '../document-presentation';
import type { ItemDeletionActions } from '../session-workspace/item-deletion-menu';

/** Notebook actions keep whole-document deletion separate from one exact historical body. */
export function DocumentNotebookDeletion({
  document,
  onDeleted,
  renderActions
}: {
  document: StudyDocumentSummary;
  onDeleted?: () => void;
  renderActions?: (actions: ItemDeletionActions) => ReactNode;
}) {
  const { t } = useI18n();
  const model = useDocumentNotebookDeletion(document, onDeleted);
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
            {t('SessionDeleteItem')}
          </Button>
          <Button size="sm" variant="ghost-destructive" onClick={() => open('version')}>
            {t('SessionDeleteVersion')}
          </Button>
        </>
      )}
      <DocumentDeletionDialog model={model} />
    </>
  );
}

function DocumentDeletionDialog({ model }: { model: Model }) {
  const { t } = useI18n();
  const { mode, setMode, preview, remove, blocked, confirming } = model;
  const copy = useDocumentDeletionCopy(model);
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
      {mode === 'version' && !confirming && <DocumentVersionChoices model={model} />}
      {mode === 'item' && preview.isFetching && <Loading label={t('LoadingStudy')} />}
      <DocumentDeletionFeedback model={model} />
    </DangerDialog>
  );
}

function useDocumentDeletionCopy(model: Model) {
  const { t } = useI18n();
  const { document, mode, confirming, selectedVersion, versionId, preview } = model;
  const label = t(mode === 'item' ? 'SessionDeleteItem' : 'SessionDeleteVersion');
  const title = mode === 'version' && !confirming ? t('SessionDeleteChooseVersion') : label;
  let description = document.title;
  if (mode === 'item') description = t('SessionDeleteItemHelp');
  else if (confirming)
    description = t('SessionDeleteChosenVersionHelp', {
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

function useDocumentNotebookDeletion(document: StudyDocumentSummary, onDeleted?: () => void) {
  const cache = useQueryClient();
  const [mode, setMode] = useState<'item' | 'version'>();
  const [versionId, setVersionId] = useState<StudyDocumentVersionId>();
  const history = useInfiniteQuery({
    ...documentHistoryOptions(document.id),
    enabled: mode === 'version'
  });
  const preview = useQuery({
    queryKey: ['documents', 'notebook-deletion', String(document.id), mode, String(versionId)],
    enabled: mode === 'item' || (mode === 'version' && versionId !== undefined),
    retry: false,
    queryFn: ({ signal }) =>
      request(
        (rpc) =>
          mode === 'item'
            ? rpc['documents.previewDeletion']({ id: document.id })
            : rpc['documents.previewHistory']({
                documentId: document.id,
                keepLatest: 1,
                versionId
              }),
        signal
      )
  });
  const remove = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!preview.data) return;
      if (mode === 'item')
        await request((rpc) =>
          rpc['documents.delete']({ documentId: document.id, token: preview.data!.token })
        );
      else
        await request((rpc) =>
          rpc['documents.retireHistory']({
            documentId: document.id,
            keepLatest: 1,
            versionId,
            token: preview.data!.token
          })
        );
      await releaseBodyPreviews(cache, {
        kind: 'document',
        documentId: String(document.id),
        versionIds: preview.data.versionIds.map(String)
      });
      await invalidateDocuments(cache);
      setMode(undefined);
      if (mode === 'item') onDeleted?.();
    },
    onError: async () => {
      if (preview.data)
        await releaseBodyPreviews(cache, {
          kind: 'document',
          documentId: String(document.id),
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

type Model = ReturnType<typeof useDocumentNotebookDeletion>;

function DocumentVersionChoices({ model }: { model: Model }) {
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
      {versions.length === 1 && !history.hasNextPage && <p>{t('SessionDeleteNoOlderVersions')}</p>}
      {history.hasNextPage && (
        <Button
          disabled={history.isFetchingNextPage || preview.isFetching}
          onClick={() => void history.fetchNextPage()}
        >
          {t('LibraryMore')}
        </Button>
      )}
    </>
  );
}

function DocumentDeletionFeedback({ model }: { model: Model }) {
  const { t } = useI18n();
  const { mode, history, preview, remove, blocked } = model;
  return (
    <>
      {' '}
      {model.versionId !== undefined && preview.isSuccess && !preview.isFetching && blocked && (
        <p>{t('SessionDeleteVersionProtected')}</p>
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
