import type { PageId, ProjectId, SourceId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Button } from '@study/ui';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';

import { CursorWindowActions, useCursorWindow } from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation';
import { PageActionDialog } from './page-action-dialog';

export function DocumentAttachments({
  pageId,
  projectId
}: {
  pageId: PageId;
  projectId: ProjectId;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>();
  const fileId = useId();
  const window = useCursorWindow<SourceId>(String(pageId));
  const links = rpc.pages.attachments.useQuery(
    open ? { pageId, projectId, cursor: window.cursor, limit: window.limit } : undefined
  );
  const setAttachment = rpc.pages.setAttachment.useMutation();
  const busy = uploading || setAttachment.isPending;

  async function change(sourceId: SourceId, attached: boolean) {
    setError(undefined);

    try {
      await setAttachment.mutate({ pageId, projectId, sourceId, attached });
    } catch (cause) {
      setError(cause);
    }
  }

  async function upload(file: File) {
    setUploading(true);
    setError(undefined);

    try {
      const source = await rpc.sources.create.call({
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
        projectId
      });

      await change(source.id, true);
    } catch (cause) {
      setError(cause);
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <Button variant="ghost-muted" onClick={() => setOpen(true)}>
        {t('NoteAttachments')}
      </Button>
      {open && (
        <PageActionDialog
          pending={busy}
          onClose={() => setOpen(false)}
          title={t('NoteAttachments')}
          description={t('NoteAttachFiles')}
        >
          <label htmlFor={fileId}>{t(uploading ? 'NoteUploading' : 'NoteAttach')}</label>
          <input
            id={fileId}
            type="file"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];

              event.currentTarget.value = '';

              if (file) void upload(file);
            }}
          />
          {error != null && <ContentReadError error={error} />}
          {links.error && (
            <ContentReadError error={links.error} retry={() => void links.refetch()} />
          )}
          <ul>
            {links.data?.items.map((source) => (
              <li key={String(source.id)}>
                <Link
                  to="/sources/$sourceId"
                  params={{ sourceId: String(source.id) }}
                  search={{ project: String(projectId), fromUploads: '1' }}
                >
                  {source.name}
                </Link>
                <Button
                  variant="ghost-muted"
                  disabled={busy}
                  onClick={() => void change(source.id, false)}
                >
                  {t('RemoveAttachment')}
                </Button>
              </li>
            ))}
          </ul>
          <CursorWindowActions
            {...window}
            hasMore={!!links.data?.nextCursor}
            pending={links.isFetching}
            more={() => window.more(links.data?.nextCursor)}
          />
        </PageActionDialog>
      )}
    </>
  );
}
