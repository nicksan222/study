import { Button } from '@study/ui/button';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

/** Shared history navigation keeps each owner's exact identity and query state with its caller. */

export function HistoryDisclosure({
  open,
  onOpenChange,
  onCurrent,
  error,
  more,
  children
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCurrent: () => void;
  error?: ReactNode;
  more?: { pending: boolean; load: () => void };
  children: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <details open={open} onToggle={(event) => onOpenChange(event.currentTarget.open)}>
      <summary>{t('ReaderHistory')}</summary>
      <Button variant="ghost" onClick={onCurrent}>
        {t('ReaderCurrent')}
      </Button>
      {error}
      {children}
      {more && (
        <Button disabled={more.pending} onClick={more.load}>
          {t('LibraryMore')}
        </Button>
      )}
    </details>
  );
}
