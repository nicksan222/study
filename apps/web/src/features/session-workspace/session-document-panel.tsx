import type { MaterialId, SessionId } from '@study/contracts/ids';
import type { MaterialDetailDto } from '@study/contracts/materials/schemas';
import { Button } from '@study/ui/button';
import { Loading } from '@study/ui/loading';
import { SessionDeskSurface as Desk } from '@study/ui/session-desk';
import { useQuery } from '@tanstack/react-query';
import { Check, Cloud, CloudOff } from 'lucide-react';

import { useI18n } from '../../lib/i18n';
import { CanonicalDocumentEditor } from './canonical-document-editor';
import { SaveRecoveryNotice } from './save-recovery';
import { DocumentMetadata } from './session-document-metadata';
import {
  sessionDocumentOptions,
  useSessionDocumentAutosave,
  useSessionDocumentCreation
} from './session-document.queries';
import { SessionReadError } from './status';

export function SessionDocumentPanel({
  materialId,
  sessionId,
  onOpen
}: {
  materialId: MaterialId;
  sessionId: SessionId;
  onOpen: (material: MaterialDetailDto) => void;
}) {
  const { t } = useI18n();
  const state = useQuery(sessionDocumentOptions(materialId));

  if (state.isPending) return <Loading label={t('LoadingStudy')} />;

  if (state.error)
    return <SessionReadError error={state.error} retry={() => void state.refetch()} />;

  if (!state.data) return null;

  return state.data.version.content.kind === 'document' &&
    state.data.version.creator !== 'import' ? (
    <DocumentEditor material={state.data} />
  ) : (
    <ImportedDocument material={state.data} sessionId={sessionId} onOpen={onOpen} />
  );
}

function DocumentEditor({ material }: { material: MaterialDetailDto }) {
  const { t } = useI18n();
  const model = useSessionDocumentAutosave(material);
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
              <DocumentMetadata material={material} />
            </>
          }
        />
      </Desk.Editor>
    </>
  );
}

function ImportedDocument({
  material,
  sessionId,
  onOpen
}: {
  material: MaterialDetailDto;
  sessionId: SessionId;
  onOpen: (material: MaterialDetailDto) => void;
}) {
  const { t } = useI18n();
  const creation = useSessionDocumentCreation(sessionId);
  const content = material.version.content;
  const document =
    content.kind === 'document'
      ? content
      : 'extracted' in content
        ? content.extracted?.document
        : undefined;
  const copy = () => {
    if (!document) return;

    void creation
      .create(material.title, { document, inputVersionId: material.version.id })
      .then((result) => {
        if (result) onOpen(result);
      });
  };

  if (!document) return <DocumentUnavailable material={material} />;

  return (
    <>
      {creation.error !== undefined && <SessionReadError error={creation.error} retry={copy} />}
      <Desk.Editor>
        <CanonicalDocumentEditor
          document={document}
          onChange={() => undefined}
          disabled
          toolbarEnd={
            <Button size="sm" variant="outline" onClick={copy} disabled={creation.pending}>
              {t(creation.pending ? 'SessionSaving' : 'DocumentEditCopy')}
            </Button>
          }
        />
      </Desk.Editor>
    </>
  );
}

function DocumentUnavailable({ material }: { material: MaterialDetailDto }) {
  const { t } = useI18n();

  return (
    <Desk.Recovery>
      {material.importProcessing?.status === 'pending' ? (
        <Loading label={t('SessionPending')} />
      ) : (
        <p>{t('SessionReadUnavailable')}</p>
      )}
    </Desk.Recovery>
  );
}
