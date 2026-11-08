import type { PageId, PageVersionId } from '@study/contracts/ids';
import type { PageVersion } from '@study/contracts/pages/types';
import { IconButton } from '@study/ui/icon-button';
import { Notebook } from '@study/ui/note-workspace';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { pageHistoryOptions } from '#web/lib/study-client/pages.queries.ts';

import { ContentReadError } from '../document-presentation';

export function PageVersionStepper({
  pageId,
  version,
  headVersionId,
  onChange,
  pending
}: {
  pageId: PageId;
  version: PageVersion | undefined;
  headVersionId: PageVersionId | null;
  onChange: (id: PageVersionId) => void;
  pending: boolean;
}) {
  const { t } = useI18n();
  const history = usePageVersionNavigation(pageId, version, onChange);
  const { previous, next, busy, older } = history;

  return (
    <>
      <Notebook.VersionStepper role="group" aria-label={t('ReaderHistory')}>
        <IconButton
          variant="ghost-muted"
          size="icon-sm"
          label={t('NotePreviousVersion')}

          disabled={pending || busy || !previous}
          onClick={older}
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </IconButton>
        <PageVersionLabel version={version} headVersionId={headVersionId} />
        <IconButton
          variant="ghost-muted"
          size="icon-sm"
          label={t('NoteNextVersion')}

          disabled={pending || busy || !next}
          onClick={() => {
            if (next) onChange(next.id);
          }}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </IconButton>
      </Notebook.VersionStepper>
      {history.query.error && (
        <ContentReadError error={history.query.error} retry={() => void history.query.refetch()} />
      )}
    </>
  );
}

function usePageVersionNavigation(
  pageId: PageId,
  version: PageVersion | undefined,
  onChange: (id: PageVersionId) => void
) {
  const query = useInfiniteQuery(pageHistoryOptions(pageId));
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

function PageVersionLabel({
  version,
  headVersionId
}: {
  version: PageVersion | undefined;
  headVersionId: PageVersionId | null;
}) {
  const { t } = useI18n();
  const latest = version?.id === headVersionId;
  const number = String(version?.number ?? '');

  return (
    <Notebook.VersionLabel
      role="status"
      data-latest={latest || undefined}
      aria-label={t('NoteVersionLabel', { number })}
    >
      {latest ? t('NoteVersionLatest') : number}
    </Notebook.VersionLabel>
  );
}
