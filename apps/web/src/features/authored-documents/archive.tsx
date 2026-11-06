import type { StudyDocumentSummary } from '@study/contracts/documents/types';
import type { ProjectId, StudyDocumentId } from '@study/contracts/ids';
import { LoadMoreButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { Dialog, DialogTrigger } from '@study/ui/dialog';
import { Input } from '@study/ui/input';
import { Loading } from '@study/ui/loading';
import { SelectionSurface as Surface } from '@study/ui/selection';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { FileText, Search } from 'lucide-react';
import { useId, useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { documentsOptions } from '#web/lib/study-client/documents.queries.ts';

import { ContentReadError, DocumentReader } from '../document-presentation';
import { sessionDocumentOptions } from '../session-workspace';
import { DocumentContextMenu } from './document-context-menu';

export function DocumentsArchive({ project }: { project?: ProjectId }) {
  const { t } = useI18n();

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>{t('DocumentsArchived')}</DialogTrigger>
      <Surface.Popup closeLabel={t('Close')} bottomStickOnMobile={false}>
        <Surface.Title>{t('DocumentsArchived')}</Surface.Title>
        <ArchiveContents project={project} />
      </Surface.Popup>
    </Dialog>
  );
}

function ArchiveContents({ project }: { project?: ProjectId }) {
  const { t } = useI18n();
  const searchId = useId();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string>();
  const state = useInfiniteQuery(documentsOptions(project, true));
  const items = state.isError ? [] : (state.data?.pages.flatMap((page) => page.items) ?? []);
  const active = items.find((item) => String(item.id) === selected);

  return (
    <Surface.Root>
      <Surface.Navigation aria-label={t('DocumentsArchived')}>
        <Surface.Search htmlFor={searchId}>
          <Search aria-hidden="true" />
          <Input
            id={searchId}
            type="search"
            aria-label={t('Search')}
            placeholder={t('Search')}
            value={search}
            onValueChange={setSearch}
          />
        </Surface.Search>
        {state.isPending && <Loading label={t('LoadingStudy')} />}
        {state.error && <ContentReadError error={state.error} retry={() => void state.refetch()} />}
        <Surface.Materials>
          {items
            .filter((item) =>
              item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
            )
            .map((item) => (
              <li key={String(item.id)}>
                <DocumentContextMenu document={item} project={project}>
                  <Surface.Material
                    type="button"
                    aria-current={item === active ? 'page' : undefined}
                    onClick={() => setSelected(String(item.id))}
                  >
                    <FileText aria-hidden="true" />
                    <span>{item.title}</span>
                  </Surface.Material>
                </DocumentContextMenu>
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
        <Surface.Header>
          <h2>{active?.title ?? t('DocumentsArchived')}</h2>
        </Surface.Header>
        <Surface.Scroll>
          <Surface.Body>
            <ArchiveBody active={active} empty={!state.isPending && items.length === 0} />
          </Surface.Body>
        </Surface.Scroll>
      </Surface.Main>
    </Surface.Root>
  );
}

function ArchiveBody({ active, empty }: { active?: StudyDocumentSummary; empty: boolean }) {
  const { t } = useI18n();

  if (active) return <ArchivePreview id={active.id} />;

  return empty ? <p>{t('DocumentsArchivedEmpty')}</p> : null;
}

function ArchivePreview({ id }: { id: StudyDocumentId }) {
  const { t } = useI18n();
  const document = useQuery(sessionDocumentOptions(id));

  if (document.isPending) return <Loading label={t('LoadingStudy')} />;

  if (document.error)
    return <ContentReadError error={document.error} retry={() => void document.refetch()} />;

  return document.data?.version ? (
    <DocumentReader document={document.data.version.document} />
  ) : null;
}
