import { ContextMenuItem, ContextMenuSeparator } from '@study/ui/context-menu';
import { FileMinus2, Trash2 } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';

export type ItemDeletionActions = {
  onDeleteItem: () => void;
  onDeleteVersion: () => void;
  open: boolean;
  disabled?: boolean;
  versionDisabled?: boolean;
};

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
        {t('SessionDeleteItem')}
      </ContextMenuItem>
      <ContextMenuItem
        variant="destructive"
        disabled={disabled || versionDisabled}
        onClick={onDeleteVersion}
      >
        <FileMinus2 aria-hidden="true" />
        {t('SessionDeleteVersion')}
      </ContextMenuItem>
    </>
  );
}
