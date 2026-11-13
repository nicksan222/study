import type { NoteId, PageId, SourceId } from '@study/contracts/ids';
import { Loading } from '@study/ui/loading';
import { WorkspaceSurface } from '@study/ui/workspace';
import { WorkspaceDeskSurface as Desk } from '@study/ui/workspace-desk';
import { useQuery } from '@tanstack/react-query';

import { useI18n } from '#client/lib/i18n.tsx';

import { NoteAssistantPanel } from '../assistant';
import { SourcePanel } from '../source-library';
import { Composer } from './composer';
import { NoteContextActions } from './context-actions';
import { History } from './history';
import { NoteSummary } from './note-editor';
import { NotePagePanel } from './note-page-panel';
import { linkedPagesOptions, notePageOptions, useNotePageCreation } from './note-page.queries';
import { PagePanel } from './page-panel';
import { NoteReadError } from './status';
import { useWorkbench, workbenchIdentity } from './workbench.queries';
import type { WorkbenchTarget } from './workbench.queries';
import { WorkspaceContext } from './workspace-context';

function TabLabel({ target }: { target: WorkbenchTarget }) {
  const { t } = useI18n();

  if (target.kind === 'assistant') return t('NoteAssistant');

  if (target.kind === 'source') return target.title;

  if (target.kind === 'page') return <PageTab target={target} />;

  const text =
    target.kind === 'new'
      ? (target.text ?? '')
      : (target.message.versions.find((version) => version.id === target.message.activeVersionId)
          ?.text ?? '');

  return <NoteSummary value={text} fallback={t('NoteNewPage')} />;
}

function PageTab({ target }: { target: Extract<WorkbenchTarget, { kind: 'page' }> }) {
  const material = useQuery(notePageOptions(target.pageId));

  return material.data?.title ?? target.title;
}

/** Keeps quick note and document work side by side, with one full-screen editor on narrow displays. */

export function NoteWorkbench({ id, onDelete }: { id: NoteId; onDelete: () => void }) {
  const { t } = useI18n();
  const model = useWorkbench(id);
  const pages = useQuery(linkedPagesOptions(id));
  const creation = useNotePageCreation(id);
  const active = model.tabs.find((tab) => workbenchIdentity(tab) === model.active);
  const openPage = (material: { id: PageId; title: string }) =>
    model.open({ kind: 'page', pageId: material.id, title: material.title });
  const openSource = (source: { id: SourceId; name: string }) =>
    model.open({ kind: 'source', sourceId: source.id, title: source.name });
  const create = () => {
    void creation.create(t('NoteNewPage')).then((material) => {
      if (material) openPage(material);
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
                  listError={pages.error}
                  reload={() => void pages.refetch()}
                />
                <History
                  id={id}
                  pages={pages.data?.items}
                  onOpenPage={openPage}
                  onOpenSource={openSource}
                  activeAuthoredPage={
                    model.visible && active?.kind === 'page' ? String(active.pageId) : undefined
                  }
                  onPage={create}
                  activePage={model.visible ? model.active : undefined}
                  onOpen={(message) => model.open({ kind: 'message', message })}
                />
              </Desk.BoardBody>
            </Desk.Board>
            <WorkspaceContext
              id={id}
              onOpenPage={openPage}
              onOpenSource={openSource}
              hidden={!model.cardVisible}
              onDismiss={model.hideCard}
              actions={
                <NoteContextActions
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
            <Composer id={id} onPage={create} />
          </WorkspaceSurface.Dock>
        </Desk.FloatingComposer>
      </Desk.Notebook>

      <EditorPanel id={id} model={model} active={active} create={create} openPage={openPage} />
    </Desk.Root>
  );
}

function EditorPanel({
  id,
  model,
  active,
  create,
  openPage
}: {
  id: NoteId;
  model: ReturnType<typeof useWorkbench>;
  active: WorkbenchTarget | undefined;
  create: () => void;
  openPage: (material: { id: PageId; title: string }) => void;
}) {
  const { t } = useI18n();

  if (!model.visible || !active) return null;

  return (
    <Desk.Panel
      active={workbenchIdentity(active)}
      tabs={model.tabs.map((target) => ({
        id: workbenchIdentity(target),
        label: <TabLabel target={target} />,
        closeLabel: t('NoteClosePage')
      }))}
      onCreate={create}
      createLabel={t('NoteNewPage')}
      onSelect={model.select}
      onClose={model.close}
      onHide={model.hide}
      onExpand={model.expand}
      expanded={model.expanded}
      expandLabel={t(model.expanded ? 'NoteRestoreEditor' : 'NoteExpandEditor')}
      closeLabel={t('NotePageTabs')}
      hideLabel={t('NoteBackToBoard')}
    >
      {active.kind === 'assistant' ? (
        <NoteAssistantPanel key={String(id)} noteId={id} />
      ) : active.kind === 'page' ? (
        <NotePagePanel key={workbenchIdentity(active)} pageId={active.pageId} />
      ) : active.kind === 'source' ? (
        <SourcePanel
          key={workbenchIdentity(active)}
          noteId={id}
          sourceId={active.sourceId}
          onDeleted={() => model.close(workbenchIdentity(active))}
          onOpenPage={openPage}
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
      {pending && <Loading label={t('NoteAutosaving')} />}
      {creationError !== undefined && <NoteReadError error={creationError} retry={create} />}
      {listError && <NoteReadError error={listError} retry={reload} />}
    </>
  );
}
