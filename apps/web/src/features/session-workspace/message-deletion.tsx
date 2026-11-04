import type { ChatMessage } from '@study/contracts/conversations/messages';
import type { VersionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { DangerDialog } from '@study/ui/danger-dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileMinus2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { request } from '#web/lib/study-client/request.ts';

import type { ItemDeletionActions } from './item-deletion-menu';
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
    retry: false,
    mutationFn: async (intent: 'item' | VersionId) => {
      if (intent === 'item')
        await request((rpc) => rpc['conversations.deleteMessage']({ id: message.id }));
      else
        await request((rpc) =>
          rpc['conversations.deleteMessageVersion']({ messageId: message.id, versionId: intent })
        );
    },
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
          <Button
            size="icon-sm"
            variant="ghost-destructive"
            aria-label={t('SessionDeleteItem')}
            title={t('SessionDeleteItem')}
            disabled={disabled || remove.isPending}
            onClick={() => show('item')}
          >
            <Trash2 aria-hidden="true" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost-destructive"
            aria-label={t('SessionDeleteVersion')}
            title={t(last ? 'SessionDeleteLastVersion' : 'SessionDeleteVersion')}
            disabled={disabled || last || remove.isPending}
            onClick={() => show(versionId)}
          >
            <FileMinus2 aria-hidden="true" />
          </Button>
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
