import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { materialsOptions } from '../material-library/material-library.queries';

/** A global, explicitly refreshed review for a possibly accepted unscoped creation. */
export function CreationLibraryReview({
  busy,
  onResolve
}: {
  busy: boolean;
  onResolve: () => void;
}) {
  const { t } = useI18n();
  const [refreshed, setRefreshed] = useState(false);
  const library = useInfiniteQuery({ ...materialsOptions(), enabled: false });
  const reviewable = refreshed && library.isSuccess && !library.isFetching && !library.hasNextPage;
  return (
    <section aria-label={t('DocumentCreationReviewAll')} className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('DocumentCreationReviewAll')}</p>
      <Button
        type="button"
        disabled={busy || library.isFetching}
        onClick={async () => {
          setRefreshed(false);
          const result = await library.refetch();
          setRefreshed(!result.isError);
        }}
      >
        {t('LibraryRefresh')}
      </Button>
      {library.isFetching && <p role="status">{t('collections.loading')}</p>}
      {library.isError && (
        <ErrorState title={t('ErrorStateTitle')} description={<> {t('LibraryLoadFailed')} </>} />
      )}
      {refreshed && library.data && (
        <>
          {library.data.pages.every((page) => page.items.length === 0) && (
            <p>{t('DocumentCreationReviewEmpty')}</p>
          )}
          <ul className="max-h-60 overflow-auto divide-y divide-border">
            {library.data.pages
              .flatMap((page) => page.items)
              .map((item) => (
                <li key={String(item.id)} className="py-2">
                  <Link
                    to="/materials/$materialId"
                    params={{ materialId: String(item.id) }}
                    search={{}}
                  >
                    {item.title}
                  </Link>
                </li>
              ))}
          </ul>
          {library.hasNextPage && (
            <Button
              type="button"
              disabled={busy || library.isFetching}
              onClick={() => void library.fetchNextPage()}
            >
              {t('LibraryMore')}
            </Button>
          )}
        </>
      )}
      {reviewable && (
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!busy && reviewable) onResolve();
          }}
        >
          {t('DocumentCreationReviewed')}
        </Button>
      )}
    </section>
  );
}
