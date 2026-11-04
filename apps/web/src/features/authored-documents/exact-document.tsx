import type { StudyDocumentId, StudyDocumentVersionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { useQuery } from '@tanstack/react-query';

import { useI18n } from '#web/lib/i18n.tsx';
import { documentVersionOptions } from '#web/lib/study-client/documents.queries.ts';

import { RetainedDocumentReader } from '../document-presentation';

/** An unavailable exact version never falls back to the current authored head. */
export function ExactAuthoredDocument({
  id,
  documentId
}: {
  id: StudyDocumentVersionId;
  documentId: StudyDocumentId;
}) {
  const { t } = useI18n();
  const state = useQuery(documentVersionOptions(id));
  if (state.isPending) return <Loading label={t('LoadingStudy')} />;
  if (state.isError || state.data.documentId !== documentId)
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
