import type { ChatMessage } from '@study/contracts/conversations/messages';
import type { VersionId } from '@study/contracts/ids';
import { DangerDialog } from '@study/ui/danger-dialog';
import { IconButton } from '@study/ui/icon-button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileMinus2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import type { ItemDeletionActions } from './item-deletion-menu';
import { messageDeletionOptions } from './message-deletion.queries';
import { sessionKey } from './session-workspace.queries';
import { SessionError } from './status';

/** Keeps whole-item removal and exact-version removal as separate confirmed intents. */
export function MessageDeletion({
  message,
  versionId,
  disabled = false,
  onVersionDeleted,
  onDeleted,
  renderActions
}: {
  message: ChatMessage;
  versionId: VersionId;
  disabled?: boolean;
  onVersionDeleted?: () => void;
  onDeleted?: () => void;
  renderActions?: (actions: ItemDeletionActions) => ReactNode;
}) {
  const { t } = useI18n();
  const cache = useQueryClient();
  const [target, setTarget] = useState<'item' | VersionId>();
  const last = message.versions.filter((version) => version.status === 'complete').length < 2;
  const remove = useMutation({
    ...messageDeletionOptions(message.id),
    onSuccess: (_, intent) => {
      if (intent !== 'item') onVersionDeleted?.();
      else onDeleted?.();

      setTarget(undefined);
      void cache.invalidateQueries({ queryKey: sessionKey(message.sessionId) });
      void cache.invalidateQueries({ queryKey: ['sessions'] });
    }
  });
  const item = target === 'item';
  const label = t(item ? 'SessionDeleteItem' : 'SessionDeleteVersion');

  function show(intent: 'item' | VersionId) {
    remove.reset();
    setTarget(intent);
  }

  return (
    <>
      {renderActions ? (
        renderActions({
          onDeleteItem: () => show('item'),
          onDeleteVersion: () => show(versionId),
          open: target !== undefined,
          disabled: disabled || remove.isPending,
          versionDisabled: last
        })
      ) : (
        <>
          <IconButton
            size="icon-sm"
            variant="ghost-destructive"
            label={t('SessionDeleteItem')}

            disabled={disabled || remove.isPending}
            onClick={() => show('item')}
          >
            <Trash2 aria-hidden="true" />
          </IconButton>
          <IconButton
            size="icon-sm"
            variant="ghost-destructive"
            label={t('SessionDeleteVersion')}

            disabled={disabled || last || remove.isPending}
            onClick={() => show(versionId)}
          >
            <FileMinus2 aria-hidden="true" />
          </IconButton>
        </>
      )}
      <DangerDialog
        open={target !== undefined}
        onOpenChange={(open) => {
          if (!open) setTarget(undefined);
        }}
        title={label}
        description={t(item ? 'SessionDeleteItemHelp' : 'SessionDeleteVersionHelp')}
        confirmLabel={label}
        cancelLabel={t('Cancel')}
        pending={remove.isPending}
        disabled={disabled}
        confirmation={{
          identity: String(message.id) + ':' + String(target),
          value: t('DeleteConfirmationWord'),
          label: t('DeleteConfirmationInstruction', { word: t('DeleteConfirmationWord') })
        }}
        onConfirm={() => {
          if (target !== undefined) remove.mutate(target);
        }}
      >
        {remove.error && <SessionError error={remove.error} />}
      </DangerDialog>
    </>
  );
}
