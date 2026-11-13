import { ContextMenuItem, ContextMenuSeparator } from '@study/ui/context-menu';
import type { ItemDeletionActions } from '@study/ui/context-menu';
import { FileMinus2, Trash2 } from 'lucide-react';

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
        <Trash2 aria-hidden="true" />
        {t('NoteDeleteItem')}
      </ContextMenuItem>
      <ContextMenuItem
        variant="destructive"
        disabled={disabled || versionDisabled}
        onClick={onDeleteVersion}
      >
        <FileMinus2 aria-hidden="true" />
        {t('NoteDeleteVersion')}
      </ContextMenuItem>
    </>
  );
}
