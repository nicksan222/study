import { Button } from '@study/ui/button';
import { DocumentEditing } from '@study/ui/document-editing';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { documentsOptions } from '#web/lib/study-client/documents.queries.ts';

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
  const library = useInfiniteQuery({ ...documentsOptions(), enabled: false });
  const reviewable = completedReview(refreshed, library);

  return (
    <DocumentEditing.CreationReview aria-label={t('DocumentCreationReviewAll')}>
      <DocumentEditing.Muted>{t('DocumentCreationReviewAll')}</DocumentEditing.Muted>
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
      {library.isFetching && <Loading label={t('collections.loading')} />}
      {library.isError && (
        <ErrorState title={t('ErrorStateTitle')} description={<> {t('LibraryLoadFailed')} </>} />
      )}
      {refreshed && library.data && (
        <>
          {library.data.pages.every((page) => page.items.length === 0) && (
            <p>{t('DocumentCreationReviewEmpty')}</p>
          )}
          <DocumentEditing.ReviewList>
            {library.data.pages
              .flatMap((page) => page.items)
              .map((item) => (
                <DocumentEditing.ReviewRow key={String(item.id)}>
                  <Link
                    to="/documents/$documentId"
                    params={{ documentId: String(item.id) }}
                    search={{}}
                  >
                    {item.title}
                  </Link>
                </DocumentEditing.ReviewRow>
              ))}
          </DocumentEditing.ReviewList>
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
    </DocumentEditing.CreationReview>
  );
}

function completedReview(
  refreshed: boolean,
  library: { isSuccess: boolean; isFetching: boolean; hasNextPage: boolean }
) {
  return refreshed && library.isSuccess && !library.isFetching && !library.hasNextPage;
}
