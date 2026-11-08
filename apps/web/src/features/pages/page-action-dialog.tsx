import { Dialog, DialogPopup } from '@study/ui/dialog';
import { DialogHeading } from '@study/ui/dialog-heading';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

/** Shared close guard and accessible heading for pending document actions. */
export function PageActionDialog({
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
        <DialogHeading title={<> {title} </>} description={<> {description} </>} />
        {children}
      </DialogPopup>
    </Dialog>
  );
}
