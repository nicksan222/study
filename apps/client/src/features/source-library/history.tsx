import type { ContentSnapshotId, SourceId } from '@study/contracts';
import { HistoryIcon, SelectedIcon } from '@study/icons';
import {
  Button,
  IconButton,
  Dialog,
  DialogTrigger,
  DialogHeading,
  SourceReader,
  Loading,
  LoadMoreButton,
  StatusMessage
} from '@study/ui';
import { useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation';
import { useSourceHistory } from './history.queries';

type Extraction = { revision: bigint; snapshotId: ContentSnapshotId };

/** History is a separate reading task; selecting a version returns to the document. */
export function SourceHistory({
  sourceId,
  selected,
  onSelect
}: {
  sourceId: SourceId;
  selected?: Extraction;
  onSelect: (exact: Extraction | undefined) => void;
}) {
  const { t, date } = useI18n();
  const [open, setOpen] = useState(false);
  const history = useSourceHistory(sourceId, open);

  function select(exact: Extraction | undefined) {
    onSelect(exact);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<IconButton size="icon-sm" label={t('ReaderHistory')} />}>
        <HistoryIcon aria-hidden="true" />
      </DialogTrigger>
      <SourceReader.DetailsPopup closeLabel={t('Close')}>
        <DialogHeading title={t('ReaderHistory')} />
        <SourceReader.HistoryBody>
          <SourceReader.Version
            variant="ghost"
            aria-current={!selected ? 'true' : undefined}
            onClick={() => select(undefined)}
          >
            <span>{t('ReaderCurrent')}</span>
            {!selected && <SelectedIcon aria-hidden="true" />}
          </SourceReader.Version>
          {history.isFetching && !history.data && <Loading label={t('LoadingStudy')} />}
          {history.error && (
            <ContentReadError error={history.error} retry={() => void history.refetch()} />
          )}
          {history.data?.items.length === 0 && (
            <StatusMessage>{t('SourceHistoryNoVersions')}</StatusMessage>
          )}
          <SourceReader.Versions>
            {history.data?.items.map((item) => {
              const active =
                selected?.revision === item.revision && selected.snapshotId === item.snapshotId;

              return (
                <li key={`${item.revision}:${item.snapshotId}`}>
                  <SourceReader.Version
                    variant="ghost"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => select(item)}
                  >
                    <SourceReader.VersionCopy>
                      <span>
                        {t('ReaderVersion')} {String(item.revision)}
                      </span>
                      <SourceReader.VersionDate
                        dateTime={new Date(Number(item.createdAt) * 1000).toISOString()}
                      >
                        {date(item.createdAt, { dateStyle: 'medium', timeStyle: 'medium' })}
                      </SourceReader.VersionDate>
                    </SourceReader.VersionCopy>
                    {active && <SelectedIcon aria-hidden="true" />}
                  </SourceReader.Version>
                </li>
              );
            })}
          </SourceReader.Versions>
          {history.hasPrevious && (
            <Button variant="ghost" size="sm" onClick={history.previous}>
              {t('LibraryPrevious')}
            </Button>
          )}
          {history.data?.next && (
            <LoadMoreButton
              variant="ghost"
              size="sm"
              disabled={history.isFetching}
              onClick={() => void history.loadMore()}
              label={t('LibraryMore')}
            />
          )}
        </SourceReader.HistoryBody>
      </SourceReader.DetailsPopup>
    </Dialog>
  );
}
