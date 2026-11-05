import type { StudyDocumentSummary } from '@study/contracts/documents/types';
import type { ProjectId } from '@study/contracts/ids';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPopup,
  ContextMenuItem,
  ContextMenuSeparator
} from '@study/ui/context-menu';
import { Dialog, DialogPopup, DialogHeader, DialogTitle } from '@study/ui/dialog';
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

import { useI18n } from '#web/lib/i18n.tsx';
import { invalidateDocuments } from '#web/lib/study-client/documents.queries.ts';
import { request } from '#web/lib/study-client/request.ts';

import { ContentReadError } from '../document-presentation';
import { DocumentMetadataDialog, sessionDocumentOptions } from '../session-workspace';
import { DocumentAiDialog } from './document-ai-dialog';
import { DocumentDeletionDialog } from './retirement';

type Action = 'metadata' | 'ai' | 'delete';

/** One menu for document links in the sidebar and the overview. */
export function DocumentContextMenu({
  document,
  project,
  children
}: {
  document: StudyDocumentSummary;
  project?: ProjectId;
  children: ReactElement;
}) {
  const { t } = useI18n();
  const [action, setAction] = useState<Action>();
  const cache = useQueryClient();
  const archive = useMutation({
    mutationFn: () =>
      request((rpc) =>
        rpc['documents.archive']({ id: document.id, archived: document.archivedAt === null })
      ),
    onSuccess: () => invalidateDocuments(cache)
  });
  const search = project ? { project: String(project) } : {};

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger render={children} />
        <ContextMenuPopup>
          <ContextMenuItem
            render={
              <Link
                to="/documents/$documentId"
                params={{ documentId: String(document.id) }}
                search={search}
              />
            }
          >
            <ArrowUpRight aria-hidden="true" />
            {t('DocumentOpen')}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setAction('metadata')}>
            <Text aria-hidden="true" />
            {t('DocumentRename')}
          </ContextMenuItem>
          <ContextMenuItem disabled={!document.headVersionId} onClick={() => setAction('ai')}>
            <Sparkles aria-hidden="true" />
            {t('DocumentAskAI')}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!document.headVersionId}
            render={
              <Link
                to="/documents/$documentId"
                params={{ documentId: String(document.id) }}
                search={{ ...search, documentVersion: document.headVersionId?.toString() }}
              />
            }
          >
            <History aria-hidden="true" />
            {t('ReaderHistory')}
          </ContextMenuItem>
          <ContextMenuItem disabled={archive.isPending} onClick={() => archive.mutate()}>
            {document.archivedAt === null ? (
              <Archive aria-hidden="true" />
            ) : (
              <ArchiveRestore aria-hidden="true" />
            )}
            {t(document.archivedAt === null ? 'DocumentsArchive' : 'DocumentsUnarchive')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => setAction('delete')}>
            <Trash2 aria-hidden="true" />
            {t('DocumentDeleteAction')}
          </ContextMenuItem>
        </ContextMenuPopup>
      </ContextMenu>
      {archive.error && <ContentReadError error={archive.error} />}
      {action && (
        <DocumentActionDialog
          id={document.id}
          action={action}
          project={project}
          onClose={() => setAction(undefined)}
        />
      )}
    </>
  );
}

function DocumentActionDialog({
  id,
  action,
  project,
  onClose
}: {
  id: StudyDocumentSummary['id'];
  action: Action;
  project?: ProjectId;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const state = useQuery(sessionDocumentOptions(id));

  if (!state.data || state.error)
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogPopup closeLabel={t('Close')}>
          <DialogHeader>
            <DialogTitle>{t('DocumentEditing')}</DialogTitle>
          </DialogHeader>
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
      <DocumentMetadataDialog
        document={state.data}
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      />
    );

  if (action === 'delete')
    return <DocumentDeletionDialog document={state.data} onClose={onClose} />;

  return <DocumentAiDialog document={state.data} project={project} onClose={onClose} />;
}
