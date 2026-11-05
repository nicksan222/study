import type { StudyDocument } from '@study/contracts/documents/types';
import type { StudyDocumentId } from '@study/contracts/ids';
import { Loading } from '@study/ui/loading';
import { SessionDeskSurface as Desk } from '@study/ui/session-desk';
import { useQuery } from '@tanstack/react-query';
import { Check, Cloud, CloudOff } from 'lucide-react';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { CanonicalDocumentEditor } from './canonical-document-editor';
import { SaveRecoveryNotice } from './save-recovery';
import { DocumentMetadata } from './session-document-metadata';
import { sessionDocumentOptions, useSessionDocumentAutosave } from './session-document.queries';
import { SessionReadError } from './status';

type EditorActions = { actions?: (document: StudyDocument) => ReactNode };

export function SessionDocumentPanel({
  documentId,
  actions
}: { documentId: StudyDocumentId } & EditorActions) {
  const { t } = useI18n();
  const state = useQuery(sessionDocumentOptions(documentId));

  if (state.isPending) return <Loading label={t('LoadingStudy')} />;

  if (state.error)
    return <SessionReadError error={state.error} retry={() => void state.refetch()} />;

  if (!state.data) return null;

  return state.data.version ? (
    <DocumentEditor document={state.data} actions={actions} />
  ) : (
    <Desk.Recovery>
      <p>{t('SessionReadUnavailable')}</p>
    </Desk.Recovery>
  );
}

function DocumentEditor({ document, actions }: { document: StudyDocument } & EditorActions) {
  const { t } = useI18n();
  const model = useSessionDocumentAutosave(document);
  const Icon = model.error ? CloudOff : model.dirty ? Cloud : Check;
  const label = model.pending
    ? 'SessionAutosaving'
    : model.dirty
      ? 'SessionAutosavePending'
      : 'SessionAutosaved';

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
      <Desk.Editor>
        <CanonicalDocumentEditor
          document={model.document}
          onChange={model.change}
          toolbarEnd={
            <>
              <Desk.SaveStatus role="status">
                <Icon size={14} />
                {t(label)}
              </Desk.SaveStatus>
              <DocumentMetadata document={document} />
              {actions?.(document)}
            </>
          }
        />
      </Desk.Editor>
    </>
  );
}
