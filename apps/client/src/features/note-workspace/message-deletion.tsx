import type { VersionId, ChatMessage } from '@study/contracts';
import { rpc, useIndependentMutation } from '@study/contracts/react';
import { RemoveFromPageIcon, DeleteIcon } from '@study/icons';
import { DangerDialog, IconButton, Notebook } from '@study/ui';
import { Effect } from 'effect';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';
import { toStudyError } from '#client/lib/study-client/errors.ts';

import type { ItemDeletionActions } from './item-deletion-menu';
import { NoteError } from './status';

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
  const [target, setTarget] = useState<'item' | VersionId>();
  const last = message.versions.filter((version) => version.status === 'complete').length < 2;
  const remove = useIndependentMutation((intent: 'item' | VersionId) =>
    Effect.tryPromise({
      try: async () => {
        if (intent === 'item') {
          await rpc.notes.deleteMessage.call({ id: message.id });
          onDeleted?.();
        } else {
          await rpc.notes.deleteMessageVersion.call({ messageId: message.id, versionId: intent });
          onVersionDeleted?.();
        }

        setTarget(undefined);
      },
      catch: toStudyError
    })
  );
  const item = target === 'item';
  const label = t(item ? 'NoteDeleteItem' : 'NoteDeleteVersion');

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
            label={t('NoteDeleteItem')}

            disabled={disabled || remove.isPending}
            onClick={() => show('item')}
          >
            <DeleteIcon aria-hidden="true" />
            <Notebook.ActionLabel>{t('NoteDeleteItem')}</Notebook.ActionLabel>
          </IconButton>
          <IconButton
            size="icon-sm"
            variant="ghost-destructive"
            label={t('NoteDeleteVersion')}

            disabled={disabled || last || remove.isPending}
            onClick={() => show(versionId)}
          >
            <RemoveFromPageIcon aria-hidden="true" />
            <Notebook.ActionLabel>{t('NoteDeleteVersion')}</Notebook.ActionLabel>
          </IconButton>
        </>
      )}
      <DangerDialog
        open={target !== undefined}
        onOpenChange={(open) => {
          if (!open) setTarget(undefined);
        }}
        title={label}
        description={t(item ? 'NoteDeleteItemHelp' : 'NoteDeleteVersionHelp')}
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
          if (target !== undefined) void remove.mutate(target).catch(() => {});
        }}
      >
        {remove.error && <NoteError error={remove.error} />}
      </DangerDialog>
    </>
  );
}
