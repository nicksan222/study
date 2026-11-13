import type { PageId, PageVersionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { useQuery } from '@tanstack/react-query';

import { useI18n } from '#client/lib/i18n.tsx';
import { pageVersionOptions } from '#client/lib/study-client/pages.queries.ts';

import { RetainedDocumentReader } from '../document-presentation';

/** An unavailable exact version never falls back to the current authored head. */

export function ExactAuthoredPageContent({ id, pageId }: { id: PageVersionId; pageId: PageId }) {
  const { t } = useI18n();
  const state = useQuery(pageVersionOptions(id));

  if (state.isPending) return <Loading label={t('LoadingStudy')} />;

  if (state.isError || state.data.pageId !== pageId)
    return (
      <ErrorState
        title={t('ReaderUnavailable')}
        action={<Button onClick={() => void state.refetch()}>{t('LibraryRefresh')}</Button>}
      />
    );

  return (
    <RetainedDocumentReader snapshotId={state.data.snapshotId} document={state.data.document} />
  );
}
