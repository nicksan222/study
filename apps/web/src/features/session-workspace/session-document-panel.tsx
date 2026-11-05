import type { StudyDocument, StudyDocumentVersion } from '@study/contracts/documents/types';
import type { StudyDocumentId, StudyDocumentVersionId } from '@study/contracts/ids';
import { Loading } from '@study/ui/loading';
import { SessionDeskSurface as Desk } from '@study/ui/session-desk';
import { useQuery } from '@tanstack/react-query';
import { Check, Cloud, CloudOff } from 'lucide-react';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { documentVersionOptions } from '#web/lib/study-client/documents.queries.ts';

import { CanonicalDocumentEditor } from './canonical-document-editor';
import { SaveRecoveryNotice } from './save-recovery';
import { DocumentMetadata } from './session-document-metadata';
import { sessionDocumentOptions, useSessionDocumentAutosave } from './session-document.queries';
import { SessionReadError } from './status';

type EditorActions = {
  renderActions?: (
    document: StudyDocument,
    version: StudyDocumentVersion,
    disabled: boolean
  ) => ReactNode;
  versionId?: StudyDocumentVersionId;
};

export function SessionDocumentPanel({
  documentId,
  renderActions,
  versionId
}: { documentId: StudyDocumentId } & EditorActions) {
  const { t } = useI18n();
  const state = useQuery(sessionDocumentOptions(documentId));

  if (state.isPending) return <Loading label={t('LoadingStudy')} />;

  if (state.error)
    return <SessionReadError error={state.error} retry={() => void state.refetch()} />;

  if (!state.data) return null;

  return state.data.version ? (
    <DocumentEditor document={state.data} renderActions={renderActions} versionId={versionId} />
  ) : (
    <Desk.Recovery>
      <p>{t('SessionReadUnavailable')}</p>
    </Desk.Recovery>
  );
}

function DocumentEditor({
  document,
  renderActions,
  versionId
}: { document: StudyDocument } & EditorActions) {
  const model = useSessionDocumentAutosave(document);
  const { historical, exact, version, unavailable } = useViewedDocument(document, versionId);
  const blocked = model.dirty || model.pending || model.error !== undefined;

  return (
    <>
      <DocumentRecovery
        model={model}
        historical={historical}
        exact={exact}
        unavailable={unavailable}
      />
      {version !== undefined && (
        <Desk.Editor>
          <CanonicalDocumentEditor
            document={historical ? version.document : model.document}
            disabled={historical || exact.isFetching}
            snapshotId={version.snapshotId}
            projectId={document.projectIds[0]}
            onChange={model.change}
            toolbarEnd={
              <>
                <DocumentSaveStatus model={model} />
                <DocumentMetadata document={document} />
                {renderActions?.(document, version, blocked || exact.isFetching)}
              </>
            }
          />
        </Desk.Editor>
      )}
    </>
  );
}

function useViewedDocument(document: StudyDocument, versionId?: StudyDocumentVersionId) {
  const historical = versionId !== undefined && versionId !== document.headVersionId;
  const exact = useQuery({ ...documentVersionOptions(versionId!), enabled: historical });
  const candidate = historical ? exact.data : document.version;
  const version = candidate?.documentId === document.id ? candidate : undefined;

  return { historical, exact, version, unavailable: historical && exact.isSuccess && !version };
}

function DocumentSaveStatus({ model }: { model: ReturnType<typeof useSessionDocumentAutosave> }) {
  const { t } = useI18n();
  const Icon = model.error ? CloudOff : model.dirty ? Cloud : Check;
  const label = model.pending
    ? 'SessionAutosaving'
    : model.dirty
      ? 'SessionAutosavePending'
      : 'SessionAutosaved';

  return (
    <Desk.SaveStatus role="status">
      <Icon size={14} />
      {t(label)}
    </Desk.SaveStatus>
  );
}

function DocumentRecovery({
  model,
  historical,
  exact,
  unavailable
}: {
  model: ReturnType<typeof useSessionDocumentAutosave>;
} & Omit<ReturnType<typeof useViewedDocument>, 'version'>) {
  const { t } = useI18n();

  return (
    <>
      {model.error !== undefined && (
        <Desk.Recovery>
          <SaveRecoveryNotice
            conflict={!!model.conflict}
            onAccept={model.acceptSavedVersion}
            onRetry={() => void model.save()}
          />
        </Desk.Recovery>
      )}
      {historical && exact.error && (
        <SessionReadError error={exact.error} retry={() => void exact.refetch()} />
      )}
      {historical && exact.isPending && <Loading label={t('LoadingStudy')} />}
      {unavailable && (
        <Desk.Recovery>
          <p>{t('ReaderUnavailable')}</p>
        </Desk.Recovery>
      )}
    </>
  );
}
