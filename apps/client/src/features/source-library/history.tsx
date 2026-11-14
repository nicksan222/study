import type { ContentSnapshotId, SourceId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { HistoryDisclosure, ContentReadError } from '../document-presentation';
import { useSourceHistory } from './history.queries';

type Extraction = { revision: bigint; snapshotId: ContentSnapshotId };

export function SourceHistory({
  sourceId,
  onSelect,
  presentation = 'disclosure'
}: {
  sourceId: SourceId;
  presentation?: 'disclosure' | 'inline';
  onSelect: (exact: Extraction | undefined) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(presentation === 'inline');
  const history = useSourceHistory(sourceId, open);

  return (
    <HistoryDisclosure
      presentation={presentation}
      open={open}
      onOpenChange={setOpen}
      onCurrent={() => onSelect(undefined)}
      error={
        history.error && (
          <ContentReadError error={history.error} retry={() => void history.refetch()} />
        )
      }
      more={
        history.data?.next
          ? { pending: history.isFetching, load: () => void history.loadMore() }
          : undefined
      }
    >
      {history.hasPrevious && (
        <Button variant="ghost" onClick={history.previous}>
          {t('LibraryPrevious')}
        </Button>
      )}
      <ul>
        {history.data?.items.map((item) => (
          <li key={`${item.revision}:${item.snapshotId}`}>
            <Button
              variant="ghost"
              onClick={() => onSelect({ revision: item.revision, snapshotId: item.snapshotId })}
            >
              {t('ReaderVersion')} {String(item.revision)}
              {presentation === 'disclosure' && <> · {String(item.snapshotId)}</>}
            </Button>
          </li>
        ))}
      </ul>
    </HistoryDisclosure>
  );
}
