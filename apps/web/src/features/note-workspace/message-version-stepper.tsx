import type { VersionId } from '@study/contracts/ids';
import type { ChatMessage } from '@study/contracts/notes/messages';
import { IconButton } from '@study/ui/icon-button';
import { Notebook } from '@study/ui/note-workspace';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';

export function MessageVersionStepper({
  message,
  versionId,
  disabled,
  onChange
}: {
  message: ChatMessage;
  versionId: VersionId;
  disabled: boolean;
  onChange: (id: VersionId) => void;
}) {
  const { t } = useI18n();
  const { versionNumber, previous, next, isLatest, context } = versionState(message, versionId);

  return (
    <Notebook.VersionStepper
      role="group"
      aria-label={`${t('NoteVersions')} · ${context || t('NoteNote')}`}
    >
      <IconButton
        size="icon-sm"
        variant="ghost-muted"
        label={t('NotePreviousVersion')}

        disabled={disabled || !previous}
        onClick={() => {
          if (previous) onChange(previous.id);
        }}
      >
        <ChevronLeft size={14} aria-hidden="true" />
      </IconButton>
      <Notebook.VersionLabel
        role="status"
        data-latest={isLatest || undefined}
        aria-label={t(isLatest ? 'NoteLatestVersionLabel' : 'NoteVersionLabel', {
          number: versionNumber
        })}
      >
        {isLatest ? t('NoteVersionLatest') : versionNumber}
      </Notebook.VersionLabel>
      <IconButton
        size="icon-sm"
        variant="ghost-muted"
        label={t('NoteNextVersion')}

        disabled={disabled || !next}
        onClick={() => {
          if (next) onChange(next.id);
        }}
      >
        <ChevronRight size={14} aria-hidden="true" />
      </IconButton>
    </Notebook.VersionStepper>
  );
}

function versionState(message: ChatMessage, versionId: VersionId) {
  const versions = message.versions
    .filter((version) => version.status === 'complete' || version.id === versionId)
    .toSorted((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0));
  const index = versions.findIndex((version) => version.id === versionId);
  const current = versions[index];
  const previous = versions[index - 1];
  const next = versions[index + 1];
  const latest = versions.filter((version) => version.status === 'complete').at(-1);
  const isLatest = current?.id === latest?.id;
  const context = current?.text.trim().split('\n')[0]?.slice(0, 80);
  const versionNumber = String(current?.number ?? '');

  return { versionNumber, previous, next, isLatest, context };
}
