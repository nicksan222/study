import type { MaterialId, ProjectId } from '@study/contracts/ids';
import { rpc } from '@study/contracts/react';
import { ArchiveIcon, QuizIcon, FlashcardsIcon, RestoreIcon } from '@study/icons';
import { Button } from '@study/ui/button';
import { Dialog, DialogTrigger } from '@study/ui/dialog';
import { ErrorState } from '@study/ui/error-state';
import { IconButton } from '@study/ui/icon-button';
import { SelectionSurface as Surface } from '@study/ui/selection';
import { useState } from 'react';

import { MaterialVersionContent } from '#client/features/material-library/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';

import { useArchivedMaterials, useMaterialArchive } from './practice.queries';
import { PracticeQueryState } from './query-state';

export function ArchivedPracticeAction({
  projectId,
  disabled
}: {
  projectId?: ProjectId;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <IconButton
            size="icon"
            variant="ghost-muted"
            disabled={disabled}
            label={t('PracticeArchived')}
          />
        }
      >
        <ArchiveIcon aria-hidden="true" />
      </DialogTrigger>
      <Surface.Popup
        contentLayout="fill"
        keepMounted
        closeLabel={t('Close')}
        bottomStickOnMobile={false}
      >
        <Surface.Title>{t('PracticeArchived')}</Surface.Title>
        <ArchivedPanel projectId={projectId} open={open} />
      </Surface.Popup>
    </Dialog>
  );
}

function ArchivedPanel({ projectId, open }: { projectId?: ProjectId; open: boolean }) {
  const { t } = useI18n();
  const state = useArchivedMaterials(projectId, open);
  const [selected, select] = useState<MaterialId>();
  const [search, setSearch] = useState('');
  const items = state.data?.items ?? [];
  const visible = items.filter((item) =>
    item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  );
  const active = visible.find((item) => item.id === selected) ?? visible[0];

  return (
    <Surface.Root>
      <Surface.Navigation aria-label={t('PracticeArchived')}>
        <Surface.SearchField
          label={t('PracticeSearchArchived')}
          value={search}
          onValueChange={setSearch}
        />
        {visible.map((item) => (
          <Surface.Item
            key={String(item.id)}
            aria-current={active?.id === item.id ? 'true' : undefined}
            onClick={() => select(item.id)}
            label={item.title}
            description={t(item.kind === 'quiz' ? 'SidebarQuiz' : 'Flashcards')}
            icon={
              item.kind === 'quiz' ? (
                <QuizIcon aria-hidden="true" />
              ) : (
                <FlashcardsIcon aria-hidden="true" />
              )
            }
          />
        ))}
        {state.pagination.hasPrevious && (
          <Surface.More
            pending={state.isFetching}
            onLoad={state.pagination.previous}
            label={t('LibraryPrevious')}
          />
        )}
        {state.hasNextPage && (
          <Surface.More
            pending={state.isFetchingNextPage}
            onLoad={() => void state.fetchNextPage()}
            label={t('LibraryMore')}
          />
        )}
      </Surface.Navigation>
      <Surface.Main>
        <Surface.DetailHeader title={<>{active?.title ?? t('PracticeArchived')}</>} />
        {active ? (
          <ArchivedPreview key={String(active.id)} id={active.id} open={open} />
        ) : (
          <Surface.Scroll>
            <Surface.Body>
              <PracticeQueryState state={state}>
                <Surface.EmptyState
                  icon={<ArchiveIcon aria-hidden="true" />}
                  title={<>{t(archiveEmptyTitle(search, Boolean(state.hasNextPage)))}</>}
                  description={
                    <>{t(search ? 'PracticeArchiveSearchHelp' : 'PracticeArchiveHelp')}</>
                  }
                />
              </PracticeQueryState>
            </Surface.Body>
          </Surface.Scroll>
        )}
      </Surface.Main>
    </Surface.Root>
  );
}

function ArchivedPreview({ id, open }: { id: MaterialId; open: boolean }) {
  const { t } = useI18n();
  const state = rpc.materials.get.useQuery({ id }, { enabled: open });
  const restore = useMaterialArchive(id, true);
  const version = state.data?.latestPublishedVersion ?? state.data?.version;

  return (
    <Surface.ArchiveFrame>
      <Surface.Scroll>
        <Surface.Body>
          <PracticeQueryState state={state}>
            {version && <MaterialVersionContent version={version} />}
          </PracticeQueryState>
        </Surface.Body>
      </Surface.Scroll>
      <Surface.ArchiveFooter>
        {restore.isError && <ErrorState layout="inline" title={t('PracticeArchiveError')} />}
        <Surface.ArchiveActions>
          <Button
            disabled={restore.isPending || !state.data || state.data.archived_at === null}
            onClick={() => restore.mutate()}
          >
            <RestoreIcon aria-hidden="true" />
            {t(restore.isPending ? 'PracticeSaving' : 'PracticeRestore')}
          </Button>
        </Surface.ArchiveActions>
      </Surface.ArchiveFooter>
    </Surface.ArchiveFrame>
  );
}

function archiveEmptyTitle(search: string, hasNext: boolean) {
  if (search) return 'SearchNoResults';

  return hasNext ? 'PracticeChooseArchived' : 'PracticeArchiveEmpty';
}
