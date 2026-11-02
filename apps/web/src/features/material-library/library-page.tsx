import { Button } from '@study/ui/button';
import { Dialog, DialogPopup, DialogHeader, DialogTitle } from '@study/ui/dialog';
import { ErrorState } from '@study/ui/error-state';
import { Input } from '@study/ui/input';
import { Loading } from '@study/ui/loading';
import { MaterialLibrary } from '@study/ui/material-library';
import { SelectControl } from '@study/ui/select-control';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { NewDocument } from '../document-editing';
import { useImportOperation } from './import-operation';
import { useLibraryPage } from './library-page.queries';
import { MaterialSearch } from './material-search';

type LibraryView = ReturnType<typeof useLibraryPage>;

export function LibraryPage() {
  const view = useLibraryPage();
  const {
    t,
    search,
    navigate,
    state,
    collections,
    open,
    setOpen,
    importRef,
    rememberRow,
    rememberBrowse
  } = view;

  return (
    <MaterialLibrary.Root>
      <MaterialLibrary.Heading>
        <MaterialLibrary.FocusHeading id="library-heading" tabIndex={-1}>
          {t('SidebarLibrary')}
        </MaterialLibrary.FocusHeading>
        <MaterialLibrary.Actions>
          <NewDocument />
          <Button variant="ghost" disabled={state.isFetching} onClick={() => void state.refetch()}>
            {t('LibraryRefresh')}
          </Button>
          <Button ref={importRef} onClick={() => setOpen(true)}>
            {t('LibraryImport')}
          </Button>
        </MaterialLibrary.Actions>
      </MaterialLibrary.Heading>
      <MaterialSearch key={search.project ?? 'all'} rememberRow={rememberRow} />
      <MaterialLibrary.Filter>
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
      </MaterialLibrary.Filter>
      <ImportReceipt view={view} />
      <LibraryResults view={view} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup closeLabel={t('Close')} finalFocus={importRef}>
          <DialogHeader>
            <DialogTitle>{t('LibraryImport')}</DialogTitle>
          </DialogHeader>
          <ImportForm onStart={rememberBrowse} />
        </DialogPopup>
      </Dialog>
    </MaterialLibrary.Root>
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
    <MaterialLibrary.ImportForm
      onSubmit={(event) => {
        event.preventDefault();

        if (!importReady(blocked, file, url)) return;

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
      <Button type="submit" disabled={!importReady(blocked, file, url)}>
        {t('LibraryImport')}
      </Button>
    </MaterialLibrary.ImportForm>
  );
}

function ImportReceipt({ view }: { view: LibraryView }) {
  const {
    t,
    search,
    accepted,
    refreshError,
    refreshing,
    previous,
    match,
    rememberRow,
    reveal,
    restorePrevious
  } = view;

  return (
    <>
      {accepted && (
        <MaterialLibrary.NoticeAside role="status">
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
          {refreshError && (
            <ErrorState title={t('ErrorStateTitle')} description={t('LibraryRefreshFailed')} />
          )}
          {previous && (
            <Button variant="ghost" onClick={restorePrevious}>
              {t('LibraryPrevious')}
            </Button>
          )}
        </MaterialLibrary.NoticeAside>
      )}
    </>
  );
}

function LibraryResults({ view }: { view: LibraryView }) {
  const { t, search, state, setOpen, operation, items, rememberRow } = view;

  return (
    <>
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
        <MaterialLibrary.Empty>
          <p>{t('LibraryEmpty')}</p>
          <MaterialLibrary.Actions>
            <Button onClick={() => setOpen(true)}>{t('LibraryImport')}</Button>
            <NewDocument />
          </MaterialLibrary.Actions>
        </MaterialLibrary.Empty>
      )}
      <MaterialLibrary.Rows>
        {items.map((item) => (
          <li key={String(item.id)}>
            <Link
              id={`material-${item.id}`}
              to="/materials/$materialId"
              params={{ materialId: String(item.id) }}
              search={search.project ? { project: search.project } : {}}
              onClick={() => rememberRow(`material-${item.id}`)}
            >
              <MaterialLibrary.RowTitle>{item.title}</MaterialLibrary.RowTitle>
              <MaterialLibrary.RowMeta>
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
              </MaterialLibrary.RowMeta>
            </Link>
          </li>
        ))}
      </MaterialLibrary.Rows>
      {state.hasNextPage && (
        <Button disabled={state.isFetchingNextPage} onClick={() => void state.fetchNextPage()}>
          {t('LibraryMore')}
        </Button>
      )}
    </>
  );
}

function importReady(blocked: boolean, file: File | null, url: string) {
  return !blocked && (!!file || !!url.trim());
}
