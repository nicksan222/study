import type { ProjectId } from '@study/contracts/ids';
import type { PageSummary } from '@study/contracts/pages/types';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPopup,
  ContextMenuItem,
  ContextMenuSeparator
} from '@study/ui/context-menu';
import { Dialog, DialogPopup } from '@study/ui/dialog';
import { DialogHeading } from '@study/ui/dialog-heading';
import { Loading } from '@study/ui/loading';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  History,
  Sparkles,
  Text,
  Trash2
} from 'lucide-react';
import { useState } from 'react';
import type { ReactElement } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';
import { invalidatePages } from '#client/lib/study-client/pages.queries.ts';

import { ContentReadError } from '../document-presentation';
import { PageMetadataDialog, notePageOptions } from '../note-workspace';
import { PageAiDialog } from './page-ai-dialog';
import { archivePageOptions } from './page-context.queries';
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
  const cache = useQueryClient();
  const archive = useMutation({
    ...archivePageOptions(page),
    onSuccess: () => invalidatePages(cache)
  });
  const search = project ? { project: String(project) } : {};

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger render={children} />
        <ContextMenuPopup>
          <ContextMenuItem
            render={
              <Link to="/pages/$pageId" params={{ pageId: String(page.id) }} search={search} />
            }
          >
            <ArrowUpRight aria-hidden="true" />
            {t('PageOpen')}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setAction('metadata')}>
            <Text aria-hidden="true" />
            {t('PageRename')}
          </ContextMenuItem>
          <ContextMenuItem disabled={!page.headVersionId} onClick={() => setAction('ai')}>
            <Sparkles aria-hidden="true" />
            {t('PageAskAI')}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!page.headVersionId}
            render={
              <Link
                to="/pages/$pageId"
                params={{ pageId: String(page.id) }}
                search={{ ...search, pageVersion: page.headVersionId?.toString() }}
              />
            }
          >
            <History aria-hidden="true" />
            {t('ReaderHistory')}
          </ContextMenuItem>
          <ContextMenuItem disabled={archive.isPending} onClick={() => archive.mutate()}>
            {page.archivedAt === null ? (
              <Archive aria-hidden="true" />
            ) : (
              <ArchiveRestore aria-hidden="true" />
            )}
            {t(page.archivedAt === null ? 'PagesArchive' : 'PagesUnarchive')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => setAction('delete')}>
            <Trash2 aria-hidden="true" />
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
  const state = useQuery(notePageOptions(id));

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
