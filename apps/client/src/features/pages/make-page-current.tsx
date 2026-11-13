import type { Page, PageVersion } from '@study/contracts/pages/types';
import { Button } from '@study/ui/button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';
import { invalidatePages } from '#client/lib/study-client/pages.queries.ts';

import { ContentReadError } from '../document-presentation';
import { restorePageOptions } from './restore.queries';

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
  const cache = useQueryClient();
  const attemptKey = ['page-restore-attempt', String(page.id), String(version.id)];

  const mutation = useMutation({
    ...restorePageOptions(cache, page, version),
    onSuccess: async (outcome) => {
      cache.removeQueries({ queryKey: attemptKey, exact: true });
      await invalidatePages(cache);

      if (outcome.outcome === 'saved') onRestored();
    }
  });

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
        onClick={() => mutation.mutate()}
      >
        {t('PageMakeCurrent')}
      </Button>
      {mutation.data?.outcome === 'conflict' && <span role="status">{t('PageConflict')}</span>}
      {mutation.error && (
        <ContentReadError error={mutation.error} retry={() => mutation.mutate()} />
      )}
    </>
  );
}
