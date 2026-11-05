import type { StudyDocumentVersion } from '@study/contracts/documents/types';
import type { StudyDocumentId, StudyDocumentVersionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { Notebook } from '@study/ui/session-workspace';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { documentHistoryOptions } from '#web/lib/study-client/documents.queries.ts';

import { ContentReadError } from '../document-presentation';

export function DocumentVersionStepper({
  documentId,
  version,
  headVersionId,
  onChange,
  pending
}: {
  documentId: StudyDocumentId;
  version: StudyDocumentVersion | undefined;
  headVersionId: StudyDocumentVersionId | null;
  onChange: (id: StudyDocumentVersionId) => void;
  pending: boolean;
}) {
  const { t } = useI18n();
  const history = useDocumentVersionNavigation(documentId, version, onChange);
  const { previous, next, busy, older } = history;

  return (
    <>
      <Notebook.VersionStepper role="group" aria-label={t('ReaderHistory')}>
        <Button
          variant="ghost-muted"
          size="icon-sm"
          aria-label={t('SessionPreviousVersion')}
          title={t('SessionPreviousVersion')}
          disabled={pending || busy || !previous}
          onClick={older}
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </Button>
        <DocumentVersionLabel version={version} headVersionId={headVersionId} />
        <Button
          variant="ghost-muted"
          size="icon-sm"
          aria-label={t('SessionNextVersion')}
          title={t('SessionNextVersion')}
          disabled={pending || busy || !next}
          onClick={() => {
            if (next) onChange(next.id);
          }}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </Button>
      </Notebook.VersionStepper>
      {history.query.error && (
        <ContentReadError error={history.query.error} retry={() => void history.query.refetch()} />
      )}
    </>
  );
}

function useDocumentVersionNavigation(
  documentId: StudyDocumentId,
  version: StudyDocumentVersion | undefined,
  onChange: (id: StudyDocumentVersionId) => void
) {
  const query = useInfiniteQuery(documentHistoryOptions(documentId));
  const versions = query.data?.pages.flatMap((page) => page.items) ?? [];
  const index = versions.findIndex((item) => item.id === version?.id);
  const previous = index >= 0 ? versions[index + 1] : undefined;
  const next = index > 0 ? versions[index - 1] : undefined;
  const { hasNextPage, isFetching, isError, fetchNextPage } = query;
  useEffect(() => {
    if (version && index < 0 && hasNextPage && !isFetching && !isError) void fetchNextPage();
  }, [version, index, hasNextPage, isFetching, isError, fetchNextPage]);

  async function older() {
    if (previous) {
      onChange(previous.id);
      return;
    }
    const result = await fetchNextPage();
    const items = result.data?.pages.flatMap((page) => page.items) ?? [];
    const position = items.findIndex((item) => item.id === version?.id);
    const older = position >= 0 ? items[position + 1] : undefined;
    if (older) onChange(older.id);
  }

  return {
    query,
    busy: isFetching,
    previous: index >= 0 && (!!previous || hasNextPage),
    next,
    older
  };
}

function DocumentVersionLabel({
  version,
  headVersionId
}: {
  version: StudyDocumentVersion | undefined;
  headVersionId: StudyDocumentVersionId | null;
}) {
  const { t } = useI18n();
  const latest = version?.id === headVersionId;
  const number = String(version?.number ?? '');
  return (
    <Notebook.VersionLabel
      role="status"
      data-latest={latest || undefined}
      aria-label={t('SessionVersionLabel', { number })}
    >
      {latest ? t('SessionVersionLatest') : number}
    </Notebook.VersionLabel>
  );
}
