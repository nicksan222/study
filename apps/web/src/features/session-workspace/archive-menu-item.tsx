import type { SessionArchiveTarget } from '@study/contracts/conversations/archive';
import type { SessionId } from '@study/contracts/ids';
import { ContextMenuItem } from '@study/ui/context-menu';
import { Archive } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';

import { useItemArchive } from './archive.queries';
import { SessionError } from './status';

export function ArchiveMenuItem({
  sessionId,
  target,
  disabled = false
}: {
  sessionId: SessionId;
  target: SessionArchiveTarget;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const archive = useItemArchive(sessionId, target);
  return (
    <>
      <ContextMenuItem disabled={disabled || archive.pending} onClick={() => archive.change(true)}>
        <Archive aria-hidden="true" />
        {t('SessionArchive')}
      </ContextMenuItem>
      {archive.error && <SessionError error={archive.error} />}
    </>
  );
}
