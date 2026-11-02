import type { SourceId, SessionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip } from 'lucide-react';

import { useI18n } from '../../lib/i18n';
import { toStudyError } from '../../lib/study-client/errors';
import { uploadSource } from './session-workspace.queries';
import { SessionError } from './status';

export type Attachment = {
  key: string;
  file: File;
  state: 'uploading' | 'ready' | 'rejected' | 'uncertain';
  sourceId?: SourceId;
  error?: unknown;
};
export const attachmentKey = (id: SessionId) => ['session-drafts', String(id), 'attachments'];
export function useAttachments(id: SessionId) {
  const cache = useQueryClient();
  const key = attachmentKey(id);
  const state = useQuery({
    queryKey: key,
    queryFn: () => [] as Attachment[],
    initialData: [] as Attachment[],
    staleTime: Infinity,
    gcTime: Infinity
  });
  const update = (f: (items: Attachment[]) => Attachment[]) =>
    cache.setQueryData<Attachment[]>(key, (items) => f(items ?? []));
  async function upload(entry: Attachment) {
    // Mark ownership before the first asynchronous boundary; another observer cannot replay it.
    update((items) =>
      items.map((item) =>
        item.key === entry.key ? { ...item, state: 'uploading', error: undefined } : item
      )
    );
    try {
      const source = await uploadSource(entry.file);
      update((items) =>
        items.map((item) =>
          item.key === entry.key ? { ...item, state: 'ready', sourceId: source.id } : item
        )
      );
      void cache.invalidateQueries({ queryKey: ['materials'] });
    } catch (error) {
      update((items) =>
        items.map((item) =>
          item.key === entry.key
            ? {
                ...item,
                state: toStudyError(error).kind === 'invalid_input' ? 'rejected' : 'uncertain',
                error
              }
            : item
        )
      );
    }
  }
  return {
    items: state.data,
    add(files: File[]) {
      const entries: Attachment[] = files.map((file) => ({
        key: crypto.randomUUID(),
        file,
        state: 'uploading'
      }));
      update((items) => [...items, ...entries]);
      for (const entry of entries) void upload(entry);
    },
    retry(entry: Attachment) {
      const current = cache.getQueryData<Attachment[]>(key)?.find((item) => item.key === entry.key);
      if (current?.state === 'rejected') void upload(current);
    },
    remove(entry: Attachment) {
      update((items) => items.filter((item) => item.key !== entry.key));
    },
    accept(ids: readonly SourceId[]) {
      update((items) => items.filter((item) => !item.sourceId || !ids.includes(item.sourceId)));
    }
  };
}
export function Attachments({ id, blocked }: { id: SessionId; blocked: boolean }) {
  const { t } = useI18n();
  const files = useAttachments(id);
  return (
    <div className="session-attachments">
      <label className="session-file-button" title={t('SessionAttachFiles')}>
        <Paperclip size={16} aria-hidden="true" />
        <span>{t('SessionAttach')}</span>
        <input
          type="file"
          aria-label={t('SessionAttachFiles')}
          multiple
          disabled={blocked}
          onChange={(event) => {
            files.add(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
      </label>
      {files.items.length > 0 && (
        <ul>
          {files.items.map((entry) => (
            <li key={entry.key}>
              <span>{entry.file.name}</span>
              <span role="status">
                {t(
                  entry.state === 'uploading'
                    ? 'SessionUploading'
                    : entry.state === 'ready'
                      ? 'SessionFileAccepted'
                      : entry.state === 'rejected'
                        ? 'SessionFileRejected'
                        : 'SessionUploadUncertain'
                )}
              </span>
              {entry.error && <SessionError error={entry.error} />}
              {entry.state === 'rejected' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={blocked}
                  onClick={() => files.retry(entry)}
                >
                  {t('Retry')}
                </Button>
              )}
              {entry.state !== 'uploading' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={blocked}
                  onClick={() => files.remove(entry)}
                >
                  {t(
                    entry.state === 'uncertain'
                      ? 'SessionUploadAcknowledge'
                      : 'SessionRemoveAttachment'
                  )}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
