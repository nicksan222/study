import type { Page, PageVersion } from '@study/contracts/pages/types';
import { Button } from '@study/ui/button';
import { useEffect } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation';
import { usePageRestore } from './restore.queries';

export function MakePageCurrent({
  page,
  version,
  disabled,
  onRestored,
  onBusy
}: {
  page: Page;
  version: PageVersion;
  disabled: boolean;
  onRestored: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const mutation = usePageRestore(page, version, onRestored);

  useEffect(() => {
    onBusy(mutation.isPending || mutation.isError);

    return () => onBusy(false);
  }, [onBusy, mutation.isPending, mutation.isError]);

  return (
    <>
      <Button
        variant="ghost-muted"
        size="sm"
        disabled={
          disabled ||
          mutation.isPending ||
          mutation.isError ||
          mutation.data?.outcome === 'conflict'
        }
        onClick={() => void mutation.mutate()}
      >
        {t('PageMakeCurrent')}
      </Button>
      {mutation.data?.outcome === 'conflict' && <span role="status">{t('PageConflict')}</span>}
      {mutation.error && (
        <ContentReadError error={mutation.error} retry={() => void mutation.mutate()} />
      )}
    </>
  );
}
