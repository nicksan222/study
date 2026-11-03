import type { SourceId } from '@study/contracts/ids';
import type { MaterialVersionDetailDto } from '@study/contracts/materials/schemas';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { MaterialLibrary } from '@study/ui/material-library';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { DocumentActions } from '../document-editing';
import { libraryReturn } from './browse-state';
import { ExactDocument } from './exact-document';
import { belongsToMaterial, materialId, versionId } from './identity';
import {
  downloadOriginal,
  historyOptions,
  materialOptions,
  versionOptions
} from './material-library.queries';
import { MaterialLifecycle, DeletionRecovery } from './material-lifecycle';
import { EvidenceDetails } from './reader-evidence';
import { ReaderExport } from './reader-export';
import { retrySourceProcessing } from './reader-page.queries';

export function ReaderPage() {
  const params = useParams({ from: '/materials/$materialId' });
  const search = useSearch({ from: '__root__' });
  const id = materialId(params.materialId);
  const state = useQuery(materialOptions(id));
  const { t } = useI18n();

  useEffect(() => {
    libraryReturn.fromReader = true;
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
            <Link
              to="/library"
              search={search.project ? { project: search.project } : {}}
              onClick={() => {
                libraryReturn.fromReader = true;
              }}
            />
          }
        >
          {t('ReaderBack')}
        </Button>
      </MaterialLibrary.ReaderToolbar>
      {state.isPending && <Loading label={t('LoadingStudy')} />}
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
            processing={state.data.importProcessing}
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
  current,
  processing
}: {
  id: ReturnType<typeof materialId>;
  selected: ReturnType<typeof versionId>;
  current: ReturnType<typeof versionId>;
  processing?: {
    sourceId: SourceId;
    revision: number;
    status: 'pending' | 'ready' | 'failed';
  };
}) {
  const { t } = useI18n();
  const search = useSearch({ from: '__root__' });
  const [selected] = useState(requested);
  const state = useQuery(versionOptions(selected));
  const [download, setDownload] = useState<'idle' | 'busy' | 'failed'>('idle');

  if (state.isPending) return <Loading label={t('LoadingStudy')} />;

  if (!state.data || !belongsToMaterial(state.data, id))
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
  const imported = 'sourceId' in version.content;

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
        {imported && (
          <Button
            disabled={download === 'busy'}
            onClick={async () => {
              setDownload('busy');

              try {
                await downloadOriginal(selected);
                setDownload('idle');
              } catch {
                setDownload('failed');
              }
            }}
          >
            {t('ReaderOriginal')}
          </Button>
        )}
      </MaterialLibrary.VersionToolbar>
      {download === 'busy' && <Loading label={t('ReaderDownloading')} />}
      {download === 'failed' && (
        <ErrorState
          title={t('ErrorStateTitle')}
          description={<> {t('ReaderOriginalUnavailable')} </>}
        />
      )}
      <ProcessingNotice
        active={selected === current}
        processing={processing}
        id={id}
        refresh={() => state.refetch()}
      />
      <MaterialLibrary.Document>
        <VersionContent version={version} />
      </MaterialLibrary.Document>
      <DocumentActions key={String(version.id)} version={version} current={current} />
      <EvidenceDetails version={version} />
    </>
  );
}

function VersionContent({ version }: { version: MaterialVersionDetailDto }) {
  const { t } = useI18n();
  const content = version.content;

  if (content.kind === 'document') return <ExactDocument id={version.id} />;

  if ('extracted' in content)
    return content.extracted ? (
      <ExactDocument id={version.id} />
    ) : (
      <MaterialLibrary.NoticeText>{t('ReaderNoExtraction')}</MaterialLibrary.NoticeText>
    );

  if (content.kind === 'diagram')
    return (
      <MaterialLibrary.ProseContent>
        <p>{t('ReaderDiagramSource')}</p>
        <pre>
          <code>{content.payload}</code>
        </pre>
      </MaterialLibrary.ProseContent>
    );

  if (content.kind === 'flashcards')
    return (
      <MaterialLibrary.ProseDetails>
        {content.cards.map((card) => (
          <div key={String(card.cardId)}>
            <dt>{card.front}</dt>
            <dd>{card.back}</dd>
          </div>
        ))}
      </MaterialLibrary.ProseDetails>
    );

  return (
    <MaterialLibrary.ProseList>
      {content.questions.map((question) => (
        <li key={String(question.id)}>
          <p>{question.prompt}</p>
          {question.kind === 'open' ? (
            <p>{question.referenceAnswer}</p>
          ) : (
            <ul>
              {question.choices.map((choice) => (
                <li key={String(choice.id)}>
                  {choice.text}
                  {choice.isCorrect && <span> · {t('ReaderCorrectAnswer')}</span>}
                </li>
              ))}
            </ul>
          )}
          <p>{question.explanation}</p>
        </li>
      ))}
    </MaterialLibrary.ProseList>
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
        <Button disabled={state.isFetchingNextPage} onClick={() => void state.fetchNextPage()}>
          {t('LibraryMore')}
        </Button>
      )}
    </MaterialLibrary.History>
  );
}

function ProcessingNotice({
  active,
  processing,
  id,
  refresh
}: {
  active: boolean;
  processing: Parameters<typeof SelectedVersion>[0]['processing'];
  id: ReturnType<typeof materialId>;
  refresh: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [retry, setRetry] = useState<'idle' | 'busy' | 'failed'>('idle');

  if (!active || !processing) return null;

  function refreshVersion() {
    void refresh();
    void queryClient.invalidateQueries({ queryKey: ['materials', 'detail', String(id)] });
  }

  async function retryProcessing() {
    setRetry('busy');

    try {
      await retrySourceProcessing(processing!);
      await queryClient.invalidateQueries({ queryKey: ['materials'] });
      setRetry('idle');
    } catch {
      setRetry('failed');
    }
  }

  if (processing.status === 'ready') return null;

  if (processing.status === 'failed')
    return (
      <ErrorState
        title={t('LibraryProcessingFailed')}
        description={retry === 'failed' ? t('ReaderRetryFailed') : undefined}
        action={
          <>
            <Button onClick={refreshVersion}>{t('LibraryRefresh')}</Button>
            <Button disabled={retry === 'busy'} onClick={() => void retryProcessing()}>
              {t('ReaderRetryProcessing')}
            </Button>
          </>
        }
      />
    );

  return (
    <MaterialLibrary.NoticeAside>
      <Loading label={t('LibraryPending')} />
      <Button onClick={refreshVersion}>{t('LibraryRefresh')}</Button>
    </MaterialLibrary.NoticeAside>
  );
}
