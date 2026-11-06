import { LoadMoreButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { MaterialLibrary } from '@study/ui/material-library';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { belongsToMaterial, materialId, versionId } from './identity';
import { historyOptions, materialOptions, versionOptions } from './material-library.queries';
import { MaterialLifecycle, DeletionRecovery } from './material-lifecycle';
import { ReaderExport } from './reader-export';
import { MaterialVersionContent } from './version-content';

export function ReaderPage() {
  const params = useParams({ from: '/materials/$materialId' });
  const search = useSearch({ from: '__root__' });
  const id = materialId(params.materialId);
  const state = useQuery(materialOptions(id));
  const { t } = useI18n();

  useEffect(() => {
    const main = document.querySelector<HTMLElement>('[data-library-scroll], main.study-content');

    if (main) main.scrollTop = 0;

    document.getElementById('reader-heading')?.focus({ preventScroll: true });
  }, [id, state.data?.id]);

  return (
    <MaterialLibrary.Reader>
      <MaterialLibrary.ReaderToolbar>
        <Button
          variant="ghost"
          render={
            <Link to="/practice" search={search.project ? { project: search.project } : {}} />
          }
        >
          {t('Practice')}
        </Button>
      </MaterialLibrary.ReaderToolbar>
      {state.isError && (
        <ErrorState
          title={t('ErrorStateTitle')}
          action={<DeletionRecovery key={String(id)} id={id} />}
          description={
            <>
              <p>{t('ReaderUnavailable')}</p>
              <Button onClick={() => void state.refetch()}>{t('LibraryRefresh')}</Button>
            </>
          }
        />
      )}

      {state.data && !state.isError && (
        <>
          <h1 id="reader-heading" tabIndex={-1}>
            {state.data.title}
          </h1>
          <SelectedVersion
            key={String(id) + search.version}
            id={id}
            selected={search.version ? versionId(search.version) : state.data.version.id}
            current={state.data.version.id}
          />
          <History id={id} current={state.data.version.id} />
          <MaterialLibrary.Lifecycle>
            <summary>{t('ReaderActions')}</summary>
            <MaterialLifecycle id={id} />
          </MaterialLibrary.Lifecycle>
        </>
      )}
    </MaterialLibrary.Reader>
  );
}

function SelectedVersion({
  id,
  selected: requested,
  current
}: {
  id: ReturnType<typeof materialId>;
  selected: ReturnType<typeof versionId>;
  current: ReturnType<typeof versionId>;
}) {
  const { t } = useI18n();
  const search = useSearch({ from: '__root__' });
  const [selected] = useState(requested);
  const state = useQuery(versionOptions(selected));

  if (state.isPending) return <Loading label={t('LoadingStudy')} />;

  if (state.isError || !state.data || !belongsToMaterial(state.data, id))
    return (
      <ErrorState
        title={t('ErrorStateTitle')}
        description={
          <>
            <p>{t('ReaderUnavailable')}</p>
            <Button onClick={() => void state.refetch()}>{t('LibraryRefresh')}</Button>
          </>
        }
      />
    );

  const version = state.data;

  return (
    <>
      <MaterialLibrary.VersionToolbar>
        <MaterialLibrary.VersionMeta>
          {t('ReaderVersion')} {String(version.number)} ·{' '}
          {t(selected === current ? 'ReaderCurrent' : 'ReaderHistorical')}
        </MaterialLibrary.VersionMeta>
        {selected !== current && (
          <Button
            variant="ghost"
            render={
              <Link
                to="/materials/$materialId"
                params={{ materialId: String(id) }}
                search={{ ...search, version: String(current) }}
              />
            }
          >
            {t('ReaderCurrent')}
          </Button>
        )}
        <ReaderExport key={String(version.id)} version={version} />
      </MaterialLibrary.VersionToolbar>
      <MaterialLibrary.Document>
        <MaterialVersionContent version={version} />
      </MaterialLibrary.Document>
    </>
  );
}

function History({
  id,
  current
}: {
  id: ReturnType<typeof materialId>;
  current: ReturnType<typeof versionId>;
}) {
  const { t, date } = useI18n();
  const [open, setOpen] = useState(false);
  const state = useInfiniteQuery({ ...historyOptions(id), enabled: open });
  const search = useSearch({ from: '__root__' });
  const loading = state.isPending && open;

  return (
    <MaterialLibrary.History open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t('ReaderHistory')}</summary>
      {loading && <Loading label={t('LoadingStudy')} />}
      {state.isError && (
        <ErrorState
          title={t('ReaderUnavailable')}
          action={<Button onClick={() => void state.refetch()}>{t('LibraryRefresh')}</Button>}
        />
      )}
      <ul>
        {state.data?.pages
          .flatMap((page) => page.items)
          .map((version) => (
            <li key={String(version.id)}>
              <Link
                to="/materials/$materialId"
                params={{ materialId: String(id) }}
                search={{ ...search, version: String(version.id) }}
                aria-current={
                  search.version === String(version.id) ||
                  (!search.version && version.id === current)
                    ? 'page'
                    : undefined
                }
              >
                {t('ReaderVersion')} {String(version.number)} · {date(version.created_at)}
                {version.availability === 'unavailable' && <> · {t('ReaderUnavailable')}</>}
              </Link>
            </li>
          ))}
      </ul>
      {state.hasNextPage && (
        <LoadMoreButton
          disabled={state.isFetchingNextPage}
          onClick={() => void state.fetchNextPage()}
          label={t('LibraryMore')}
        />
      )}
    </MaterialLibrary.History>
  );
}
