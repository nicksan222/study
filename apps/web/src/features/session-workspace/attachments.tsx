import type { SessionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { Notebook } from '@study/ui/session-workspace';
import { Paperclip } from 'lucide-react';

import { useI18n } from '../../lib/i18n';
import { useAttachments } from './attachments.queries';
import { SessionError } from './status';
export { useAttachments, attachmentKey } from './attachments.queries';

export function Attachments({ id, blocked }: { id: SessionId; blocked: boolean }) {
  const { t } = useI18n();
  const files = useAttachments(id);

  return (
    <Notebook.Attachments>
      <Notebook.FileButton title={t('SessionAttachFiles')}>
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
      </Notebook.FileButton>
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
              {entry.error !== undefined && <SessionError error={entry.error} />}
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
    </Notebook.Attachments>
  );
}
