import type { NoteId, PageId, ProjectId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { BackIcon, ClosePanelIcon, MaximizeIcon, MinimizeIcon, PageIcon } from '@study/icons';
import { Button, IconButton, WorkspaceDeskSurface as Desk, WorkspacePanel } from '@study/ui';
import type { RichNoteEditorHandle } from '@study/ui';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

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
import { usePhoneLayout } from './use-phone-layout';
import { workbenchIdentity } from './workbench.queries';
import type { useWorkbench, WorkbenchTarget } from './workbench.queries';
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
  model,
  contextPanel,
  onDelete
}: {
  id: NoteId;
  title: string;
  project?: ProjectId;
  model: ReturnType<typeof useWorkbench>;
  contextPanel?: RefObject<HTMLElement | null>;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const { noteWidth } = model.appearance;
  const { history, openHistory, closeHistory, backToEditor, editor, cardCoversNotebook } =
    useNotebookHistory(model.cardVisible);
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
            <Desk.Board inert={cardCoversNotebook}>
              <Desk.BoardBody>
                {history ? (
                  <>
                    <Button
                      ref={backToEditor}
                      size="sm"
                      variant="ghost-muted"
                      onClick={closeHistory}
                    >
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
                ) : null}
                <div hidden={history}>
                  <NotebookBody id={id} title={title} editorRef={editor} />
                </div>
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
                    onNavigate={model.dismissNarrowCard}
                  />
                ) : undefined
              }
              ref={contextPanel}
              actions={
                <NoteContextActions
                  id={id}
                  project={project}
                  onHistory={() => {
                    openHistory();
                    model.dismissNarrowCard();
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

/** Transfers focus after the writing or history surface becomes available. */
function useNotebookHistory(cardVisible: boolean) {
  const cardCoversNotebook = usePhoneLayout() && cardVisible;
  const [historyView, setHistoryView] = useState<{ open: boolean }>();
  const history = historyView?.open ?? false;
  const focusedView = useRef<typeof historyView>(undefined);
  const backToEditor = useRef<HTMLButtonElement>(null);
  const editor = useCallback(
    (handle: RichNoteEditorHandle | null) => {
      if (!handle || historyView?.open !== false || focusedView.current === historyView) return;

      focusedView.current = historyView;
      handle.restoreSelection(handle.selection());
    },
    [historyView]
  );

  useLayoutEffect(() => {
    if (cardCoversNotebook || !historyView?.open || focusedView.current === historyView) return;

    focusedView.current = historyView;
    backToEditor.current?.focus();
  }, [historyView, cardCoversNotebook]);

  return {
    history,
    cardCoversNotebook,
    backToEditor,
    editor,
    openHistory: () => setHistoryView({ open: true }),
    closeHistory: () => setHistoryView({ open: false })
  };
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

  const hideLabel = t('NoteBackToBoard');
  const expandLabel = t(model.expanded ? 'NoteRestoreEditor' : 'NoteExpandEditor');

  return (
    <WorkspacePanel
      label={t('NotePageTabs')}
      active={workbenchIdentity(active)}
      tabs={model.tabs.map((target) => {
        const id = workbenchIdentity(target);

        return {
          id,
          label: <TabLabel target={target} />,
          icon: <PageIcon size={14} aria-hidden="true" />,
          close: { label: t('NoteClosePage'), onClick: () => model.close(id) }
        };
      })}
      onSelect={model.select}
      beforeTabs={
        <IconButton variant="ghost-muted" size="icon-sm" label={hideLabel} onClick={model.hide}>
          <BackIcon size={16} aria-hidden="true" />
        </IconButton>
      }
      afterTabs={
        <>
          <IconButton
            variant="ghost-muted"
            size="icon-sm"
            label={expandLabel}
            onClick={model.expand}
          >
            {model.expanded ? (
              <MinimizeIcon size={15} aria-hidden="true" />
            ) : (
              <MaximizeIcon size={15} aria-hidden="true" />
            )}
          </IconButton>
          <IconButton variant="ghost-muted" size="icon-sm" label={hideLabel} onClick={model.hide}>
            <ClosePanelIcon size={15} aria-hidden="true" />
          </IconButton>
        </>
      }
    >
      {active.kind === 'assistant' ? (
        <NoteAssistantPanel key={String(id)} noteId={id} />
      ) : active.kind === 'page' ? (
        <NotePagePanel key={workbenchIdentity(active)} pageId={active.pageId} />
      ) : (
        <PagePanel key={workbenchIdentity(active)} id={id} target={active} />
      )}
    </WorkspacePanel>
  );
}

function BoardFeedback({ listError, reload }: { listError: unknown; reload: () => void }) {
  return listError ? <NoteReadError error={listError} retry={reload} /> : null;
}
