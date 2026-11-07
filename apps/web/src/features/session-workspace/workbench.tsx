import type { SessionId, StudyDocumentId, SourceId } from '@study/contracts/ids';
import { Loading } from '@study/ui/loading';
import { WorkspaceSurface } from '@study/ui/workspace';
import { WorkspaceDeskSurface as Desk } from '@study/ui/workspace-desk';
import { useQuery } from '@tanstack/react-query';

import { useI18n } from '#web/lib/i18n.tsx';

import { SessionAssistantPanel } from '../assistant';
import { SourcePanel } from '../source-library';
import { Composer } from './composer';
import { SessionContextActions } from './context-actions';
import { History } from './history';
import { NoteSummary } from './note-editor';
import { PagePanel } from './page-panel';
import { SessionDocumentPanel } from './session-document-panel';
import {
  sessionDocumentsOptions,
  sessionDocumentOptions,
  useSessionDocumentCreation
} from './session-document.queries';
import { SessionReadError } from './status';
import { useWorkbench, workbenchIdentity } from './workbench.queries';
import type { WorkbenchTarget } from './workbench.queries';
import { WorkspaceContext } from './workspace-context';

function TabLabel({ target }: { target: WorkbenchTarget }) {
  const { t } = useI18n();

  if (target.kind === 'assistant') return t('SessionAssistant');

  if (target.kind === 'source') return target.title;

  if (target.kind === 'document') return <DocumentTab target={target} />;

  const text =
    target.kind === 'new'
      ? (target.text ?? '')
      : (target.message.versions.find((version) => version.id === target.message.activeVersionId)
          ?.text ?? '');

  return <NoteSummary value={text} fallback={t('SessionNewPage')} />;
}

function DocumentTab({ target }: { target: Extract<WorkbenchTarget, { kind: 'document' }> }) {
  const material = useQuery(sessionDocumentOptions(target.documentId));

  return material.data?.title ?? target.title;
}

/** Keeps quick conversation and document work side by side, with one full-screen editor on narrow displays. */

export function SessionWorkbench({ id, onDelete }: { id: SessionId; onDelete: () => void }) {
  const { t } = useI18n();
  const model = useWorkbench(id);
  const documents = useQuery(sessionDocumentsOptions(id));
  const creation = useSessionDocumentCreation(id);
  const active = model.tabs.find((tab) => workbenchIdentity(tab) === model.active);
  const openDocument = (material: { id: StudyDocumentId; title: string }) =>
    model.open({ kind: 'document', documentId: material.id, title: material.title });
  const openSource = (source: { id: SourceId; name: string }) =>
    model.open({ kind: 'source', sourceId: source.id, title: source.name });
  const create = () => {
    void creation.create(t('SessionNewPage')).then((material) => {
      if (material) openDocument(material);
    });
  };

  return (
    <Desk.Root
      open={model.visible && !!active}
      expanded={model.expanded}
      dock={model.dock}
      cardOpen={model.cardVisible}
    >
      <Desk.Notebook>
        <Desk.ScrollArea>
          <Desk.NotebookLayout>
            <Desk.Board>
              <Desk.BoardBody>
                <BoardFeedback
                  pending={creation.pending}
                  creationError={creation.error}
                  create={create}
                  listError={documents.error}
                  reload={() => void documents.refetch()}
                />
                <History
                  id={id}
                  documents={documents.data?.items}
                  onOpenDocument={openDocument}
                  onOpenSource={openSource}
                  activeAuthoredDocument={
                    model.visible && active?.kind === 'document'
                      ? String(active.documentId)
                      : undefined
                  }
                  onDocument={create}
                  activeDocument={model.visible ? model.active : undefined}
                  onOpen={(message) => model.open({ kind: 'message', message })}
                />
              </Desk.BoardBody>
            </Desk.Board>
            <WorkspaceContext
              id={id}
              onOpenDocument={openDocument}
              onOpenSource={openSource}
              hidden={!model.cardVisible}
              onDismiss={model.hideCard}
              actions={
                <SessionContextActions
                  id={id}
                  onDelete={onDelete}
                  onCreate={create}
                  pending={creation.pending}
                />
              }
            />
          </Desk.NotebookLayout>
        </Desk.ScrollArea>
        <Desk.NavigationHost />
        <Desk.FloatingComposer>
          <WorkspaceSurface.Dock>
            <Composer id={id} onDocument={create} />
          </WorkspaceSurface.Dock>
        </Desk.FloatingComposer>
      </Desk.Notebook>

      <EditorPanel
        id={id}
        model={model}
        active={active}
        create={create}
        openDocument={openDocument}
      />
    </Desk.Root>
  );
}

function EditorPanel({
  id,
  model,
  active,
  create,
  openDocument
}: {
  id: SessionId;
  model: ReturnType<typeof useWorkbench>;
  active: WorkbenchTarget | undefined;
  create: () => void;
  openDocument: (material: { id: StudyDocumentId; title: string }) => void;
}) {
  const { t } = useI18n();

  if (!model.visible || !active) return null;

  return (
    <Desk.Panel
      active={workbenchIdentity(active)}
      tabs={model.tabs.map((target) => ({
        id: workbenchIdentity(target),
        label: <TabLabel target={target} />,
        closeLabel: t('SessionCloseDocument')
      }))}
      onCreate={create}
      createLabel={t('SessionNewDocument')}
      onSelect={model.select}
      onClose={model.close}
      onHide={model.hide}
      onExpand={model.expand}
      expanded={model.expanded}
      expandLabel={t(model.expanded ? 'SessionRestoreEditor' : 'SessionExpandEditor')}
      closeLabel={t('SessionDocumentTabs')}
      hideLabel={t('SessionBackToBoard')}
    >
      {active.kind === 'assistant' ? (
        <SessionAssistantPanel key={String(id)} sessionId={id} />
      ) : active.kind === 'document' ? (
        <SessionDocumentPanel key={workbenchIdentity(active)} documentId={active.documentId} />
      ) : active.kind === 'source' ? (
        <SourcePanel
          key={workbenchIdentity(active)}
          sessionId={id}
          sourceId={active.sourceId}
          onDeleted={() => model.close(workbenchIdentity(active))}
          onOpenDocument={openDocument}
        />
      ) : (
        <PagePanel key={workbenchIdentity(active)} id={id} target={active} />
      )}
    </Desk.Panel>
  );
}

function BoardFeedback({
  pending,
  creationError,
  create,
  listError,
  reload
}: {
  pending: boolean;
  creationError: unknown;
  create: () => void;
  listError: Error | null;
  reload: () => void;
}) {
  const { t } = useI18n();

  return (
    <>
      {pending && <Loading label={t('SessionAutosaving')} />}
      {creationError !== undefined && <SessionReadError error={creationError} retry={create} />}
      {listError && <SessionReadError error={listError} retry={reload} />}
    </>
  );
}
