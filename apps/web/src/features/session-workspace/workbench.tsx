import type { SessionId, MaterialId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { Loading } from '@study/ui/loading';
import { SessionDeskSurface as Desk } from '@study/ui/session-desk';
import { WorkspaceSurface } from '@study/ui/workspace';
import { useQuery } from '@tanstack/react-query';
import { FilePlus2, PanelRightOpen } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';

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

function TabLabel({ target }: { target: WorkbenchTarget }) {
  const { t } = useI18n();

  if (target.kind === 'material') return <MaterialTab target={target} />;

  const text =
    target.kind === 'new'
      ? (target.text ?? '')
      : (target.message.versions.find((version) => version.id === target.message.activeVersionId)
          ?.text ?? '');

  return <NoteSummary value={text} fallback={t('SessionNewPage')} />;
}

function MaterialTab({ target }: { target: Extract<WorkbenchTarget, { kind: 'material' }> }) {
  const material = useQuery(sessionDocumentOptions(target.materialId));

  return material.data?.title ?? target.title;
}

/** Keeps quick conversation and document work side by side, with one full-screen editor on narrow displays. */
export function SessionWorkbench({ id, onDelete }: { id: SessionId; onDelete: () => void }) {
  const { t } = useI18n();
  const model = useWorkbench(id);
  const documents = useQuery(sessionDocumentsOptions(id));
  const creation = useSessionDocumentCreation(id);
  const active = model.tabs.find((tab) => workbenchIdentity(tab) === model.active);
  const openMaterial = (material: { id: MaterialId; title: string }) =>
    model.open({ kind: 'material', materialId: material.id, title: material.title });
  const create = () => {
    void creation.create(t('SessionNewPage')).then((material) => {
      if (material) openMaterial(material);
    });
  };

  return (
    <Desk.Root open={model.visible && !!active} expanded={model.expanded}>
      <Desk.Board>
        <BoardTools
          id={id}
          onDelete={onDelete}
          model={model}
          create={create}
          pending={creation.pending}
        />
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
            documents={documents.data?.items.filter((material) => material.kind === 'document')}
            onOpenMaterial={openMaterial}
            activeMaterial={
              model.visible && active?.kind === 'material' ? String(active.materialId) : undefined
            }
            onDocument={create}
            activeDocument={model.visible ? model.active : undefined}
            onOpen={(message) => model.open({ kind: 'message', message })}
          />
        </Desk.BoardBody>
        <WorkspaceSurface.Dock>
          <Composer id={id} onDocument={create} />
        </WorkspaceSurface.Dock>
      </Desk.Board>
      <EditorPanel
        id={id}
        model={model}
        active={active}
        create={create}
        openMaterial={openMaterial}
      />
    </Desk.Root>
  );
}

function BoardTools({
  id,
  onDelete,
  model,
  create,
  pending
}: {
  id: SessionId;
  onDelete: () => void;
  model: ReturnType<typeof useWorkbench>;
  create: () => void;
  pending: boolean;
}) {
  const { t } = useI18n();

  return (
    <Desk.BoardTools>
      <SessionContextActions id={id} onDelete={onDelete} compact />
      {!model.visible && model.tabs.length > 0 && (
        <Button
          size="sm"
          variant="ghost-muted"
          onClick={() => model.select(model.active ?? workbenchIdentity(model.tabs[0]!))}
        >
          <PanelRightOpen size={16} />
          {t('SessionOpenEditors')}
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={create} disabled={pending}>
        <FilePlus2 size={16} aria-hidden="true" />
        {t('SessionNewDocument')}
      </Button>
    </Desk.BoardTools>
  );
}

function EditorPanel({
  id,
  model,
  active,
  create,
  openMaterial
}: {
  id: SessionId;
  model: ReturnType<typeof useWorkbench>;
  active: WorkbenchTarget | undefined;
  create: () => void;
  openMaterial: (material: { id: MaterialId; title: string }) => void;
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
      {active.kind === 'material' ? (
        <SessionDocumentPanel
          key={workbenchIdentity(active)}
          sessionId={id}
          materialId={active.materialId}
          onOpen={openMaterial}
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
