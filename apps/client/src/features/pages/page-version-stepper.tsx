import type { PageId, PageVersionId, PageVersion } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { PreviousVersionIcon, NextVersionIcon } from '@study/icons';
import { IconButton, Notebook } from '@study/ui';
import { useEffect } from 'react';

import {
  useCursorRecovery,
  useCursorWindow,
  CursorWindowActions
} from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

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
          <PreviousVersionIcon size={14} aria-hidden="true" />
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
          <NextVersionIcon size={14} aria-hidden="true" />
        </IconButton>
      </Notebook.VersionStepper>
      <CursorWindowActions
        {...history.window}
        hasMore={!!history.query.data?.nextCursor}
        pending={history.busy}
        more={() => history.window.more(history.query.data?.nextCursor)}
      />
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
  const window = useCursorWindow<PageVersionId>(String(pageId));
  const limit = window.limit;
  const query = rpc.pages.versions.useQuery({ pageId, limit, cursor: window.cursor });

  useCursorRecovery(window, query.error);
  const versions = query.data?.items ?? [];
  const index = versions.findIndex((item) => item.id === version?.id);
  const previous = index >= 0 ? versions[index + 1] : undefined;
  const next = index > 0 ? versions[index - 1] : undefined;
  const hasMore = !!query.data?.nextCursor;
  const { isFetching, isError } = query;

  useEffect(() => {
    if (version && index < 0 && hasMore && limit < 100 && !isFetching && !isError)
      window.more(query.data?.nextCursor);
  }, [version, index, hasMore, isFetching, isError, limit, window, query.data?.nextCursor]);

  async function older() {
    if (previous) {
      onChange(previous.id);

      return;
    }

    if (!hasMore) return;

    const result = await rpc.pages.versions.read(
      olderWindowInput(pageId, window, query.data?.nextCursor)
    );

    window.more(query.data?.nextCursor);
    const older = followingVersion(result.items, version?.id, limit >= 100);

    if (older) onChange(older.id);
  }

  return {
    query,
    window,
    busy: isFetching,
    previous: index >= 0 && (!!previous || hasMore),
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

function olderWindowInput(
  pageId: PageId,
  window: ReturnType<typeof useCursorWindow<PageVersionId>>,
  next: PageVersionId | null | undefined
) {
  const extending = window.limit < 100;

  return {
    pageId,
    limit: extending ? Math.min(100, window.limit + 30) : 30,
    cursor: extending ? window.cursor : (next ?? undefined)
  };
}

function followingVersion<A extends { id: PageVersionId }>(
  items: readonly A[],
  selected: PageVersionId | undefined,
  continued: boolean
) {
  const index = items.findIndex((item) => item.id === selected);

  if (index >= 0) return items[index + 1];

  return continued ? items[0] : undefined;
}
