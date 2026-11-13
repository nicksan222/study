import type { ProjectId, PageId } from '@study/contracts/ids';
import type { PageSummary } from '@study/contracts/pages/types';
import { LoadMoreButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { Dialog, DialogTrigger } from '@study/ui/dialog';
import { Loading } from '@study/ui/loading';
import { SelectionSurface as Surface } from '@study/ui/selection';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';
import { pagesOptions } from '#client/lib/study-client/pages.queries.ts';

import { ContentReadError, DocumentReader } from '../document-presentation';
import { notePageOptions } from '../note-workspace';
import { PageContextMenu } from './page-context-menu';

export function PagesArchive({ project }: { project?: ProjectId }) {
  const { t } = useI18n();

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>{t('PagesArchived')}</DialogTrigger>
      <Surface.Popup closeLabel={t('Close')} bottomStickOnMobile={false}>
        <Surface.Title>{t('PagesArchived')}</Surface.Title>
        <ArchiveContents project={project} />
      </Surface.Popup>
    </Dialog>
  );
}

function ArchiveContents({ project }: { project?: ProjectId }) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string>();
  const state = useInfiniteQuery(pagesOptions(project, true));
  const items = state.isError ? [] : (state.data?.pages.flatMap((page) => page.items) ?? []);
  const active = items.find((item) => String(item.id) === selected);

  return (
    <Surface.Root>
      <Surface.Navigation aria-label={t('PagesArchived')}>
        <Surface.SearchField
          label={t('Search')}
          placeholder={t('Search')}
          value={search}
          onValueChange={setSearch}
        />
        {state.isPending && <Loading label={t('LoadingStudy')} />}
        {state.error && <ContentReadError error={state.error} retry={() => void state.refetch()} />}
        <Surface.Materials>
          {items
            .filter((item) =>
              item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
            )
            .map((item) => (
              <li key={String(item.id)}>
                <PageContextMenu page={item} project={project}>
                  <Surface.Item
                    type="button"
                    aria-current={item === active ? 'page' : undefined}
                    onClick={() => setSelected(String(item.id))}
                    label={item.title}
                    icon={<FileText aria-hidden="true" />}
                  />
                </PageContextMenu>
              </li>
            ))}
        </Surface.Materials>
        {state.hasNextPage && (
          <LoadMoreButton
            variant="ghost"
            disabled={state.isFetchingNextPage}
            onClick={() => void state.fetchNextPage()}
            label={t('LibraryMore')}
          />
        )}
      </Surface.Navigation>
      <Surface.Main>
        <Surface.DetailHeader title={<>{active?.title ?? t('PagesArchived')}</>} />
        <Surface.Scroll>
          <Surface.Body>
            <ArchiveBody active={active} empty={!state.isPending && items.length === 0} />
          </Surface.Body>
        </Surface.Scroll>
      </Surface.Main>
    </Surface.Root>
  );
}

function ArchiveBody({ active, empty }: { active?: PageSummary; empty: boolean }) {
  const { t } = useI18n();

  if (active) return <ArchivePreview id={active.id} />;

  return empty ? <p>{t('PagesArchivedEmpty')}</p> : null;
}

function ArchivePreview({ id }: { id: PageId }) {
  const { t } = useI18n();
  const page = useQuery(notePageOptions(id));

  if (page.isPending) return <Loading label={t('LoadingStudy')} />;

  if (page.error) return <ContentReadError error={page.error} retry={() => void page.refetch()} />;

  return page.data?.version ? <DocumentReader document={page.data.version.document} /> : null;
}
