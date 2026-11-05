import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@study/ui/dialog';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

/** Shared close guard and accessible heading for pending document actions. */
export function DocumentActionDialog({
  pending,
  onClose,
  title,
  description,
  children
}: {
  pending: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogPopup closeLabel={t('Close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogPopup>
    </Dialog>
  );
}
