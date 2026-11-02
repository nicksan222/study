import { Button } from '@study/ui/button';
import { Dialog, DialogPopup, DialogHeader, DialogTitle } from '@study/ui/dialog';
import { ErrorState } from '@study/ui/error-state';
import { Input } from '@study/ui/input';
import { Loading } from '@study/ui/loading';
import { SelectControl } from '@study/ui/select-control';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearch, useNavigate, useLocation, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { request } from '../../lib/study-client/request';
import { projectsQueryOptions } from '../../lib/study-client/study.queries';
import { NewDocument } from '../document-editing/document-actions';
import { importReturn, libraryReturn, libraryEntries } from './browse-state';
import type { BrowseSnapshot } from './browse-state';
import { collectionId } from './identity';
import { useImportOperation } from './import-operation';
import { materialPage, materialsOptions } from './material-library.queries';
import { MaterialSearch } from './material-search';

import './material-library.css';

export function LibraryPage() {
  const { t } = useI18n();
  const search = useSearch({ from: '__root__' });
  const projectId = collectionId(search.project);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const state = useInfiniteQuery(materialsOptions(projectId));
  const collections = useQuery(projectsQueryOptions());
  const [open, setOpen] = useState(false);
  const importRef = useRef<HTMLButtonElement>(null);
  const operation = useImportOperation();
  const accepted = operation.source;
  const entryKey = useLocation({
    select: (location) => location.state.__TSR_key
  });
  const revealGeneration = useRef(0);
  const restoredEntry = useRef<string | undefined>(undefined);
  const [refreshError, setRefreshError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(
    () =>
      router.subscribe('onBeforeNavigate', () => {
        // A destination loader may keep this view mounted while navigation is already in flight.
        revealGeneration.current++;
        setRefreshing(false);
      }),
    [router]
  );
  useEffect(() => {
    setRefreshing(false);
    return () => {
      revealGeneration.current++;
    };
  }, [search.project]);
  const [previous, setPrevious] = useState<BrowseSnapshot | null>(importReturn.previous);
  const items = state.data?.pages.flatMap((page) => page.items) ?? [];
  const acceptedLookup = useQuery({
    queryKey: ['materials', 'imported', String(accepted?.id)],
    enabled: !!accepted,
    queryFn: () => request((rpc) => rpc['materials.importedMaterial']({ sourceId: accepted!.id }))
  });
  const match = acceptedLookup.data;

  useEffect(() => {
    if (!state.data) return;
    const saved = entryKey ? libraryEntries.get(entryKey) : undefined;
    if (!libraryReturn.fromReader && (!saved || restoredEntry.current === entryKey)) return;
    const position = saved ?? libraryReturn;
    libraryReturn.fromReader = false;
    restoredEntry.current = entryKey;
    const main = document.querySelector<HTMLElement>('[data-library-scroll], main.study-content');
    const row = document.getElementById(position.row);
    (row ?? document.getElementById('library-heading'))?.focus({
      preventScroll: true
    });
    if (main) main.scrollTop = position.scroll;
  }, [state.data, entryKey]);

  function rememberRow(row: string) {
    libraryReturn.row = row;
    libraryReturn.scroll =
      document.querySelector<HTMLElement>('[data-library-scroll], main.study-content')?.scrollTop ??
      0;
    libraryReturn.fromReader = true;
    if (entryKey) libraryEntries.set(entryKey, { row, scroll: libraryReturn.scroll });
  }

  function rememberBrowse() {
    const snapshot = {
      project: search.project,
      data: state.data,
      scroll:
        document.querySelector<HTMLElement>('[data-library-scroll], main.study-content')
          ?.scrollTop ?? 0
    };
    importReturn.previous = snapshot;
    setPrevious(snapshot);
  }

  async function reveal() {
    const generation = ++revealGeneration.current;
    setRefreshing(true);
    setRefreshError(false);
    try {
      await queryClient.cancelQueries({
        queryKey: materialsOptions().queryKey,
        exact: true
      });
      if (generation !== revealGeneration.current) return;
      const page = await materialPage();
      if (generation !== revealGeneration.current) return;
      queryClient.setQueryData(materialsOptions().queryKey, {
        pages: [page],
        pageParams: [undefined]
      });
      await navigate({ to: '/library', search: {}, replace: true });
    } catch {
      if (generation === revealGeneration.current) setRefreshError(true);
    } finally {
      if (generation === revealGeneration.current) setRefreshing(false);
    }
  }

  return (
    <div className="material-library">
      <header className="material-heading">
        <h1 id="library-heading" className="library-focus-anchor" tabIndex={-1}>
          {t('SidebarLibrary')}
        </h1>
        <div className="material-actions">
          <NewDocument />
          <Button variant="ghost" disabled={state.isFetching} onClick={() => void state.refetch()}>
            {t('LibraryRefresh')}
          </Button>
          <Button ref={importRef} onClick={() => setOpen(true)}>
            {t('LibraryImport')}
          </Button>
        </div>
      </header>
      <MaterialSearch key={search.project ?? 'all'} rememberRow={rememberRow} />
      <div className="library-filter">
        <SelectControl
          label={t('LibraryCollection')}
          value={search.project ?? ''}
          options={[
            { value: '', label: t('LibraryAll') },
            ...(collections.data ?? []).map((collection) => ({
              value: String(collection.id),
              label: collection.name
            }))
          ]}
          onValueChange={(value) => {
            void navigate({ to: '/library', search: value ? { project: value } : {} });
          }}
        />
      </div>
      {accepted && (
        <aside className="reader-notice" role="status">
          <p>{t('LibraryAccepted')}</p>
          <p>{t('LibraryRevealPrompt')}</p>
          {search.project ? (
            <Button render={<Link to="/library" search={{}} />}>{t('LibraryAll')}</Button>
          ) : match ? (
            <Button
              render={
                <Link
                  to="/materials/$materialId"
                  params={{ materialId: String(match.id) }}
                  onClick={() => rememberRow(`material-${match.id}`)}
                  search={{}}
                />
              }
            >
              {t('LibraryOpenAccepted')}
            </Button>
          ) : (
            <p>{t('LibraryAcceptedUnresolved')}</p>
          )}
          <Button variant="ghost" disabled={refreshing} onClick={() => void reveal()}>
            {t('LibraryRefresh')}
          </Button>
          {refreshError && <p>{t('LibraryRefreshFailed')}</p>}
          {previous && (
            <Button
              variant="ghost"
              onClick={() => {
                revealGeneration.current++;
                setRefreshing(false);
                if (previous.data)
                  queryClient.setQueryData(
                    materialsOptions(collectionId(previous.project)).queryKey,
                    previous.data
                  );
                void navigate({
                  to: '/library',
                  search: previous.project ? { project: previous.project } : {}
                });
                libraryReturn.scroll = previous.scroll;
                libraryReturn.fromReader = true;
                operation.acknowledge();
                importReturn.previous = null;
                setPrevious(null);
              }}
            >
              {t('LibraryPrevious')}
            </Button>
          )}
        </aside>
      )}
      {operation.busy && <Loading label={t('LibraryImporting')} />}
      {operation.ambiguous && (
        <ErrorState title={t('ErrorStateTitle')} description={<> {t('LibraryImportFailed')} </>} />
      )}
      {state.isPending && <Loading label={t('LoadingStudy')} />}
      {state.isError && (
        <ErrorState
          title={t('ErrorStateTitle')}
          description={
            <>
              <p>{t('LibraryLoadFailed')}</p>
              <Button onClick={() => void state.refetch()}>{t('LibraryRefresh')}</Button>
            </>
          }
        />
      )}
      {state.isSuccess && items.length === 0 && (
        <section className="library-empty">
          <p>{t('LibraryEmpty')}</p>
          <div className="material-actions">
            <Button onClick={() => setOpen(true)}>{t('LibraryImport')}</Button>
            <NewDocument />
          </div>
        </section>
      )}
      <ul className="material-rows">
        {items.map((item) => (
          <li key={String(item.id)}>
            <Link
              id={`material-${item.id}`}
              to="/materials/$materialId"
              params={{ materialId: String(item.id) }}
              search={{
                ...(search.project ? { project: search.project } : {})
              }}
              onClick={() => rememberRow(`material-${item.id}`)}
            >
              <span className="material-row-title">{item.title}</span>
              <span className="material-row-meta">
                {t('ReaderVersion')} {String(item.version.number)}
                {item.importProcessing && (
                  <>
                    {' '}
                    ·{' '}
                    {t(
                      item.importProcessing.status === 'pending'
                        ? 'LibraryPending'
                        : item.importProcessing.status === 'failed'
                          ? 'LibraryProcessingFailed'
                          : 'LibraryReady'
                    )}
                  </>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {state.hasNextPage && (
        <Button disabled={state.isFetchingNextPage} onClick={() => void state.fetchNextPage()}>
          {t('LibraryMore')}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup closeLabel={t('Close')} finalFocus={importRef}>
          <DialogHeader>
            <DialogTitle>{t('LibraryImport')}</DialogTitle>
          </DialogHeader>
          <ImportForm onStart={rememberBrowse} />
        </DialogPopup>
      </Dialog>
    </div>
  );
}

export function ImportForm({ onStart }: { onStart?: () => void }) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const operation = useImportOperation();
  const { busy, ambiguous, rejected, source } = operation;
  const blocked = busy || ambiguous || !!source;
  function clearFile() {
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  }
  function startAnother() {
    operation.acknowledge();
    setUrl('');
    clearFile();
  }
  return (
    <form
      className="library-import"
      onSubmit={(event) => {
        event.preventDefault();
        if (blocked || (!file && !url.trim())) return;
        onStart?.();
        operation.start({ file, url });
      }}
    >
      <label>
        {t('LibraryFile')}
        <input
          type="file"
          ref={fileRef}
          disabled={blocked}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setUrl('');
          }}
        />
      </label>
      <label htmlFor="library-url">{t('LibraryLink')}</label>
      <Input
        id="library-url"
        type="url"
        value={url}
        disabled={blocked || !!file}
        onValueChange={setUrl}
      />
      {file && (
        <Button variant="ghost" disabled={blocked} onClick={clearFile}>
          {t('LibraryClearFile')}
        </Button>
      )}
      {ambiguous && (
        <ErrorState title={t('ErrorStateTitle')} description={<> {t('LibraryImportFailed')} </>} />
      )}
      {rejected && (
        <ErrorState
          title={t('ErrorStateTitle')}
          description={<> {t('LibraryImportRejected')} </>}
        />
      )}
      {busy && <Loading label={t('LibraryImporting')} />}
      {source && (
        <>
          <p role="status">{t('LibraryAccepted')}</p>
          <Button variant="ghost" onClick={startAnother}>
            {t('LibraryStartAnother')}
          </Button>
        </>
      )}
      {ambiguous && (
        <Button variant="ghost" onClick={startAnother}>
          {t('LibraryImportAcknowledged')}
        </Button>
      )}
      <Button type="submit" disabled={blocked || (!file && !url.trim())}>
        {t('LibraryImport')}
      </Button>
    </form>
  );
}
