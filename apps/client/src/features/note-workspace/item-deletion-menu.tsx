import { RemoveFromPageIcon, DeleteIcon } from '@study/icons';
import { ContextMenuItem, ContextMenuSeparator } from '@study/ui/context-menu';
import type { ItemDeletionActions } from '@study/ui/context-menu';

import { useI18n } from '#client/lib/i18n.tsx';

export type { ItemDeletionActions } from '@study/ui/context-menu';

export function ItemDeletionMenu({
  onDeleteItem,
  onDeleteVersion,
  disabled,
  versionDisabled
}: ItemDeletionActions) {
  const { t } = useI18n();

  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" disabled={disabled} onClick={onDeleteItem}>
        <DeleteIcon aria-hidden="true" />
        {t('NoteDeleteItem')}
      </ContextMenuItem>
      <ContextMenuItem
        variant="destructive"
        disabled={disabled || versionDisabled}
        onClick={onDeleteVersion}
      >
        <RemoveFromPageIcon aria-hidden="true" />
        {t('NoteDeleteVersion')}
      </ContextMenuItem>
    </>
  );
}
