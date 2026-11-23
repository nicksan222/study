import type { NoteId, PageId, ProjectId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Button, WorkspaceDeskSurface as Desk } from '@study/ui';
import { useState } from 'react';

import { CursorWindowActions } from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

import { NoteAssistantPanel } from '../assistant';
import { NoteContextActions } from './context-actions';
import { History } from './history';
import { NoteSummary } from './note-editor';
import { NotePagePanel } from './note-page-panel';
import { useLinkedPages } from './note-page.queries';
import { useThreadPage } from './note-reads';
import { NotebookBody } from './notebook-body';
import { NotebookOutline } from './notebook-outline';
import { PagePanel } from './page-panel';
import { NoteReadError } from './status';
import { useWorkbench, workbenchIdentity } from './workbench.queries';
import type { WorkbenchTarget } from './workbench.queries';
import { WorkspaceContext } from './workspace-context';

function TabLabel({ target }: { target: WorkbenchTarget }) {
  const { t } = useI18n();

  if (target.kind === 'assistant') return t('NoteAssistant');

  if (target.kind === 'page') return <PageTab target={target} />;

  const text =
    target.kind === 'new'
      ? (target.text ?? '')
      : (target.message.versions.find((version) => version.id === target.message.activeVersionId)
          ?.text ?? '');

  return <NoteSummary value={text} fallback={t('NoteNewPage')} />;
}

function PageTab({ target }: { target: Extract<WorkbenchTarget, { kind: 'page' }> }) {
  const material = rpc.pages.get.useQuery({ id: target.pageId });

  return material.data?.title ?? target.title;
}

/** Keeps quick note and document work side by side, with one full-screen editor on narrow displays. */
export function NoteWorkbench({
  id,
  title,
  project,
  onDelete
}: {
  id: NoteId;
  title: string;
  project?: ProjectId;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const model = useWorkbench(id);
  const { noteWidth } = model.appearance;
  const [history, setHistory] = useState(false);
  const pages = useLinkedPages(id);
  const thread = useThreadPage(id);
  const active = model.tabs.find((tab) => workbenchIdentity(tab) === model.active);
  const openPage = (material: { id: PageId; title: string }) =>
    model.open({ kind: 'page', pageId: material.id, title: material.title });

  return (
    <Desk.Root
      open={model.visible && !!active}
      expanded={model.expanded}
      dock={model.dock}
      cardOpen={model.cardVisible}
      contentWidth={noteWidth}
    >
      <Desk.Notebook>
        <Desk.ScrollArea>
          <Desk.NotebookLayout>
            <Desk.Board>
              <Desk.BoardBody>
                {history ? (
                  <>
                    <Button size="sm" variant="ghost-muted" onClick={() => setHistory(false)}>
                      {t('NoteBackToEditor')}
                    </Button>
                    <BoardFeedback listError={pages.error} reload={() => void pages.refetch()} />
                    <History
                      id={id}
                      state={thread}
                      pages={pages.data?.items}
                      onOpenPage={openPage}
                      activeAuthoredPage={
                        model.visible && active?.kind === 'page' ? String(active.pageId) : undefined
                      }
                      activePage={model.visible ? model.active : undefined}
                      onOpen={(message) => model.open({ kind: 'message', message })}
                    />
                    <CursorWindowActions
                      hasPrevious={pages.pagination.hasPrevious}
                      previous={pages.pagination.previous}
                      hasMore={pages.data?.nextCursor != null}
                      more={() => pages.pagination.more(pages.data?.nextCursor)}
                      pending={pages.isFetching}
                    />
                  </>
                ) : (
                  <NotebookBody id={id} title={title} />
                )}
              </Desk.BoardBody>
            </Desk.Board>
            <WorkspaceContext
              id={id}
              outline={
                history ? (
                  <NotebookOutline
                    id={id}
                    thread={thread}
                    pages={pages}
                    onNavigate={model.hideCard}
                  />
                ) : undefined
              }
              hidden={!model.cardVisible}
              onDismiss={model.hideCard}
              actions={
                <NoteContextActions
                  id={id}
                  project={project}
                  onHistory={() => {
                    setHistory(true);
                    model.hideCard();
                  }}
                  onDelete={onDelete}
                />
              }
            />
          </Desk.NotebookLayout>
        </Desk.ScrollArea>
        <Desk.NavigationHost />
      </Desk.Notebook>

      <EditorPanel id={id} model={model} active={active} />
    </Desk.Root>
  );
}

function EditorPanel({
  id,
  model,
  active
}: {
  id: NoteId;
  model: ReturnType<typeof useWorkbench>;
  active: WorkbenchTarget | undefined;
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
      ) : (
        <PagePanel key={workbenchIdentity(active)} id={id} target={active} />
      )}
    </Desk.Panel>
  );
}

function BoardFeedback({ listError, reload }: { listError: unknown; reload: () => void }) {
  return listError ? <NoteReadError error={listError} retry={reload} /> : null;
}
