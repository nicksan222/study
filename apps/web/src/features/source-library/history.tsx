import type { ContentSnapshotId, SourceId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { request } from '#web/lib/study-client/request.ts';

import { HistoryDisclosure } from '../document-presentation/history';
import { ContentReadError } from '../document-presentation/read-error';

type Extraction = { revision: bigint; snapshotId: ContentSnapshotId };
export function SourceHistory({
  sourceId,
  onSelect
}: {
  sourceId: SourceId;
  onSelect: (exact: Extraction | undefined) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const history = useInfiniteQuery({
    queryKey: ['sources', 'history', String(sourceId)],
    enabled: open,
    initialPageParam: undefined as Extraction | undefined,
    queryFn: ({ pageParam, signal }) =>
      request(
        (rpc) => rpc['sources.extractions']({ sourceId, limit: 30, before: pageParam }),
        signal
      ),
    getNextPageParam: (page) => page.next ?? undefined
  });
  return (
    <HistoryDisclosure
      open={open}
      onOpenChange={setOpen}
      onCurrent={() => onSelect(undefined)}
      error={
        history.error && (
          <ContentReadError error={history.error} retry={() => void history.refetch()} />
        )
      }
      more={
        history.hasNextPage
          ? { pending: history.isFetchingNextPage, load: () => void history.fetchNextPage() }
          : undefined
      }
    >
      <ul>
        {history.data?.pages
          .flatMap((page) => page.items)
          .map((item) => (
            <li key={`${item.revision}:${item.snapshotId}`}>
              <Button
                variant="ghost"
                onClick={() => onSelect({ revision: item.revision, snapshotId: item.snapshotId })}
              >
                {t('ReaderVersion')} {String(item.revision)} · {String(item.snapshotId)}
              </Button>
            </li>
          ))}
      </ul>
    </HistoryDisclosure>
  );
}
