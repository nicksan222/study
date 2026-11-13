import { LoadMoreButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { Disclosure } from '@study/ui/disclosure';
import { SelectionSurface } from '@study/ui/selection';
import type { ReactNode } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

/** Shared history navigation keeps each owner's exact identity and query state with its caller. */

export function HistoryDisclosure({
  open,
  presentation = 'disclosure',
  onOpenChange,
  onCurrent,
  error,
  more,
  children
}: {
  open: boolean;
  presentation?: 'disclosure' | 'inline';
  onOpenChange: (open: boolean) => void;
  onCurrent: () => void;
  error?: ReactNode;
  more?: { pending: boolean; load: () => void };
  children: ReactNode;
}) {
  const { t } = useI18n();

  if (presentation === 'inline')
    return (
      <SelectionSurface.History aria-label={t('ReaderHistory')}>
        <Button variant="ghost" size="sm" onClick={onCurrent}>
          {t('ReaderCurrent')}
        </Button>
        {error}
        {children}
        {more && (
          <LoadMoreButton
            variant="ghost"
            size="sm"
            disabled={more.pending}
            onClick={more.load}
            label={t('LibraryMore')}
          />
        )}
      </SelectionSurface.History>
    );

  return (
    <Disclosure
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      summary={<> {t('ReaderHistory')} </>}
    >
      <Button variant="ghost" onClick={onCurrent}>
        {t('ReaderCurrent')}
      </Button>
      {error}
      {children}
      {more && (
        <LoadMoreButton disabled={more.pending} onClick={more.load} label={t('LibraryMore')} />
      )}
    </Disclosure>
  );
}
