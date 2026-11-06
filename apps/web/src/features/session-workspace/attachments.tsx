import type { SessionId } from '@study/contracts/ids';
import { sniff, detectedMime } from '@study/contracts/sources/sniff';
import { mediaSize } from '@study/localization';
import type { StaticMessageKey } from '@study/localization';
import { AttachmentPreview, useAttachmentPreviewUrl } from '@study/ui/attachment-preview';
import { ComposerSurface } from '@study/ui/composer';
import { IconButton } from '@study/ui/icon-button';
import { Notebook } from '@study/ui/session-workspace';
import { Paperclip, RotateCcw, X } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';

import { appearances, attachmentPreviewKind } from './attachment-appearance';
import { useAttachments } from './attachments.queries';
import type { Attachment } from './attachments.queries';
import { SessionError } from './status';
export { useAttachments, attachmentKey } from './attachments.queries';

export function AttachmentPicker({ id, blocked }: { id: SessionId; blocked: boolean }) {
  const { t } = useI18n();
  const files = useAttachments(id);

  return (
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
  );
}

export function AttachmentTray({ id, blocked }: { id: SessionId; blocked: boolean }) {
  const { t } = useI18n();
  const files = useAttachments(id);

  if (!files.items.length) return null;

  return (
    <ComposerSurface.Attachments aria-label={t('SessionAttachments')}>
      {files.items.map((entry) => (
        <DraftAttachment key={entry.key} entry={entry} files={files} blocked={blocked} />
      ))}
    </ComposerSurface.Attachments>
  );
}

const uploadLabels = {
  uploading: 'SessionUploading',
  ready: 'SessionFileAccepted',
  rejected: 'SessionFileRejected',
  uncertain: 'SessionUploadUnconfirmed'
} satisfies Record<Attachment['state'], StaticMessageKey>;

function DraftAttachment({
  entry,
  files,
  blocked
}: {
  entry: Attachment;
  files: ReturnType<typeof useAttachments>;
  blocked: boolean;
}) {
  const { t, locale } = useI18n();
  const detected = draftFileType(entry.file);
  const { icon: Icon } = appearances[detected.kind];
  const mediaKind = attachmentPreviewKind(detected.kind);
  const preview = useAttachmentPreviewUrl(
    mediaKind !== 'file' && detected.mime !== 'image/svg+xml' ? entry.file : undefined
  );

  return (
    <ComposerSurface.Attachment
      name={entry.file.name}
      size={mediaSize(locale, entry.file.size)}
      status={t(uploadLabels[entry.state])}
      state={entry.state}
      icon={<Icon size={20} aria-hidden="true" />}
      preview={
        preview ? (
          <AttachmentPreview
            kind={mediaKind}
            src={preview}
            mime={detected.mime}
            label={entry.file.name}
          />
        ) : undefined
      }
      actions={<AttachmentActions entry={entry} files={files} blocked={blocked} />}
    >
      {(entry.state === 'uncertain' || entry.error !== undefined) && (
        <AttachmentRecovery entry={entry} />
      )}
    </ComposerSurface.Attachment>
  );
}

function AttachmentRecovery({ entry }: { entry: Attachment }) {
  const { t } = useI18n();

  return (
    <>
      {entry.state === 'uncertain' && <p>{t('SessionUploadUncertain')}</p>}
      {entry.error !== undefined && (
        <details>
          <summary>{t('SeeDetails')}</summary>
          <SessionError error={entry.error} />
        </details>
      )}
    </>
  );
}

function AttachmentActions({
  entry,
  files,
  blocked
}: {
  entry: Attachment;
  files: ReturnType<typeof useAttachments>;
  blocked: boolean;
}) {
  const { t } = useI18n();
  const removeLabel = t(
    entry.state === 'uncertain' ? 'SessionUploadAcknowledge' : 'SessionRemoveAttachment'
  );

  return (
    <>
      {entry.state === 'rejected' && (
        <IconButton
          size="icon-sm"
          variant="ghost-muted"
          label={t('Retry')}

          disabled={blocked}
          onClick={() => files.retry(entry)}
        >
          <RotateCcw size={14} aria-hidden="true" />
        </IconButton>
      )}
      {entry.state !== 'uploading' && (
        <IconButton
          size="icon-sm"
          variant="ghost-muted"
          label={removeLabel}

          disabled={blocked}
          onClick={() => files.remove(entry)}
        >
          <X size={14} aria-hidden="true" />
        </IconButton>
      )}
    </>
  );
}

function draftFileType(file: File) {
  const detected = sniff(file.name, new Uint8Array());

  return detected.kind === 'other' && file.type ? detectedMime(file.type) : detected;
}
