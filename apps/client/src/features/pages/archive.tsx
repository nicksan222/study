import type { PageId, ProjectId, PageSummary } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { PageIcon } from '@study/icons';
import { Button, Dialog, DialogTrigger, Loading, SelectionSurface as Surface } from '@study/ui';
import { useState } from 'react';

import { CursorWindowActions } from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

import { ContentReadError, DocumentReader } from '../document-presentation';
import { PageContextMenu } from './page-context-menu';
import { usePageBrowse } from './use-page-browse';

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
  const { query: state, navigation: window } = usePageBrowse(project, true);
  const items = state.isError ? [] : (state.data?.items ?? []);
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
                    icon={<PageIcon aria-hidden="true" />}
                  />
                </PageContextMenu>
              </li>
            ))}
        </Surface.Materials>

        <CursorWindowActions
          {...window}
          hasMore={!!state.data?.nextCursor}
          pending={state.isFetching}
          more={() => window.more(state.data?.nextCursor)}
        />
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
  const page = rpc.pages.get.useQuery({ id });

  if (page.isPending) return <Loading label={t('LoadingStudy')} />;

  if (page.error) return <ContentReadError error={page.error} retry={() => void page.refetch()} />;

  return page.data?.version ? <DocumentReader document={page.data.version.document} /> : null;
}
