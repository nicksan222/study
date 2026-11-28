import type { ProjectId, PageSummary } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import {
  ArchiveIcon,
  RestoreArchiveIcon,
  OpenIcon,
  HistoryIcon,
  AskAiIcon,
  RenameIcon,
  DeleteIcon
} from '@study/icons';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPopup,
  ContextMenuItem,
  ContextMenuSeparator,
  Dialog,
  DialogPopup,
  DialogHeading,
  Loading
} from '@study/ui';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactElement } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation';
import { PageMetadataDialog } from '../note-workspace';
import { PageAiDialog } from './page-ai-dialog';
import { PageDeletionDialog } from './retirement';

type Action = 'metadata' | 'ai' | 'delete';

/** One menu for page links in the sidebar and the overview. */
export function PageContextMenu({
  page,
  project,
  children
}: {
  page: PageSummary;
  project?: ProjectId;
  children: ReactElement;
}) {
  const { t } = useI18n();
  const [action, setAction] = useState<Action>();
  const archive = rpc.pages.archive.useMutation();
  const search = project ? { project: String(project) } : {};

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger render={children} />
        <ContextMenuPopup>
          <ContextMenuItem
            render={
              <Link
                to="/practice/study-notes/$pageId"
                params={{ pageId: String(page.id) }}
                search={search}
              />
            }
          >
            <OpenIcon aria-hidden="true" />
            {t('PageOpen')}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setAction('metadata')}>
            <RenameIcon aria-hidden="true" />
            {t('PageRename')}
          </ContextMenuItem>
          <ContextMenuItem disabled={!page.headVersionId} onClick={() => setAction('ai')}>
            <AskAiIcon aria-hidden="true" />
            {t('PageAskAI')}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!page.headVersionId}
            render={
              <Link
                to="/practice/study-notes/$pageId"
                params={{ pageId: String(page.id) }}
                search={{ ...search, pageVersion: page.headVersionId?.toString() }}
              />
            }
          >
            <HistoryIcon aria-hidden="true" />
            {t('ReaderHistory')}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={archive.isPending}
            onClick={() => void archive.mutate({ id: page.id, archived: page.archivedAt === null })}
          >
            {page.archivedAt === null ? (
              <ArchiveIcon aria-hidden="true" />
            ) : (
              <RestoreArchiveIcon aria-hidden="true" />
            )}
            {t(page.archivedAt === null ? 'PagesArchive' : 'PagesUnarchive')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => setAction('delete')}>
            <DeleteIcon aria-hidden="true" />
            {t('PageDeleteAction')}
          </ContextMenuItem>
        </ContextMenuPopup>
      </ContextMenu>
      {archive.error && <ContentReadError error={archive.error} />}
      {action && (
        <PageActionDialog
          id={page.id}
          action={action}
          project={project}
          onClose={() => setAction(undefined)}
        />
      )}
    </>
  );
}

function PageActionDialog({
  id,
  action,
  project,
  onClose
}: {
  id: PageSummary['id'];
  action: Action;
  project?: ProjectId;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const state = rpc.pages.get.useQuery({ id });

  if (!state.data || state.error)
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogPopup closeLabel={t('Close')}>
          <DialogHeading title={<> {t('PageEditing')} </>} />
          {state.error ? (
            <ContentReadError error={state.error} retry={() => void state.refetch()} />
          ) : (
            <Loading label={t('LoadingStudy')} />
          )}
        </DialogPopup>
      </Dialog>
    );

  if (action === 'metadata')
    return (
      <PageMetadataDialog
        page={state.data}
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      />
    );

  if (action === 'delete') return <PageDeletionDialog page={state.data} onClose={onClose} />;

  return <PageAiDialog page={state.data} project={project} onClose={onClose} />;
}
