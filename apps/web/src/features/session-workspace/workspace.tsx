import { projectIdSchema, sessionIdSchema } from '@study/contracts/ids';
import type { SessionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { ComposerSurface } from '@study/ui/composer';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';
import { ArrowRight, NotebookPen } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { toStudyError } from '../../lib/study-client/errors';
import { useAttachments } from './attachments';
import { Composer } from './composer';
import { emptyDraft } from './draft';
import type { Draft } from './draft';
import { History } from './history';
import { SelectionPanel } from './selection';
import {
  createSession,
  deleteSession,
  deletionOptions,
  retryDeletion,
  sessionOptions,
  sessionPagesOptions
} from './session-workspace.queries';
import { SessionError, SessionReadError } from './status';
import { Transformation } from './transformation';

import './workspace.css';

export function SessionWorkspace() {
  const search = useSearch({ from: '__root__' });
  const id = search.id ? Schema.decodeUnknownSync(sessionIdSchema)(BigInt(search.id)) : undefined;
  return (
    <div className="session-workspace">
      {id ? <SessionBody key={String(id)} id={id} /> : <SessionStart />}
    </div>
  );
}
function SessionStart() {
  const { t, date } = useI18n();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ from: '__root__' });
  const project = search.project
    ? Schema.decodeUnknownSync(projectIdSchema)(BigInt(search.project))
    : undefined;
  const state = useInfiniteQuery(sessionPagesOptions(project));
  const draftKey = ['session-start-draft', search.project ?? 'all'];
  const draft = useQuery({
    queryKey: draftKey,
    queryFn: () => '',
    initialData: '',
    gcTime: Infinity,
    staleTime: Infinity
  });
  const flow = useQuery({
    queryKey: ['session-workspace', 'creation'],
    queryFn: () => ({}) as { id?: SessionId; uncertain?: boolean; pending?: boolean },
    initialData: {} as { id?: SessionId; uncertain?: boolean; pending?: boolean },
    gcTime: Infinity,
    staleTime: Infinity
  });
  const [navigationError, setNavigationError] = useState<unknown>();
  const [reviewed, setReviewed] = useState(false);
  async function select(id: SessionId) {
    try {
      await navigate({ to: '/sessions', search: { ...search, id: String(id) } });
      setNavigationError(undefined);
    } catch (error) {
      setNavigationError(error);
    }
  }
  const create = useMutation({
    mutationFn: createSession,
    retry: false,
    onMutate: () => {
      cache.setQueryData(['session-workspace', 'creation'], { uncertain: true, pending: true });
      setReviewed(false);
    },
    onError: (error) => {
      if (toStudyError(error).kind === 'invalid_input')
        cache.setQueryData(['session-workspace', 'creation'], {});
    },
    onSettled: () => {
      cache.setQueryData<{ id?: SessionId; uncertain?: boolean; pending?: boolean }>(
        ['session-workspace', 'creation'],
        (previous) => ({ ...previous, pending: false })
      );
    },
    onSuccess: (created) => {
      const text = cache.getQueryData<string>(draftKey) ?? '';
      cache.setQueryData<Draft>(['session-drafts', String(created.id), 'note'], {
        ...emptyDraft,
        text
      });
      cache.setQueryData(draftKey, '');
      cache.setQueryData(['session-workspace', 'creation'], { id: created.id });
      void cache.invalidateQueries({ queryKey: ['sessions'] });
      void select(created.id);
    }
  });
  function beginSession() {
    const current = cache.getQueryData<{ id?: SessionId; uncertain?: boolean; pending?: boolean }>([
      'session-workspace',
      'creation'
    ]);
    if (current?.id || current?.uncertain || current?.pending) return;
    cache.setQueryData(['session-workspace', 'creation'], { uncertain: true, pending: true });
    create.mutate();
  }
  const items = state.data?.pages.flatMap((page) => page.items) ?? [];
  const blocked = create.isPending || !!flow.data.id || !!flow.data.uncertain;
  if (state.isError && !flow.data.uncertain && !flow.data.id) {
    return (
      <SessionReadError error={state.error} retry={() => void state.refetch()} layout="page" />
    );
  }
  return (
    <div className="session-start">
      <div className="session-start-content">
        <header className="session-start-heading">
          <h1>{t('SessionStartTitle')}</h1>
          <p>{t('SessionStartHelp')}</p>
        </header>
        <ComposerSurface.Root aria-label={t('SessionCompose')}>
          <ComposerSurface.Input
            aria-label={t('SessionCompose')}
            aria-describedby="session-start-hint"
            placeholder={t('SessionStartPlaceholder')}
            value={draft.data}
            onChange={(event) => cache.setQueryData(draftKey, event.target.value)}
            onKeyDown={(event) => {
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key === 'Enter' &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (!blocked) beginSession();
              }
            }}
          />
          <ComposerSurface.Footer>
            <span className="session-start-kind">
              <NotebookPen size={16} aria-hidden="true" />
              {t('SessionNotebook')}
            </span>
            <Button disabled={blocked} onClick={beginSession}>
              {t('SessionNew')}
              <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </ComposerSurface.Footer>
        </ComposerSurface.Root>
        <ComposerSurface.Hint id="session-start-hint">
          {t('SessionStartDraftHelp')}
        </ComposerSurface.Hint>
        {flow.data.pending && (
          <p role="status" className="session-muted">
            {t('SessionStarting')}
          </p>
        )}
        {flow.data.id && (
          <Button variant="outline" onClick={() => void select(flow.data.id!)}>
            {t('SessionOpenCreated')}
          </Button>
        )}
        {!!navigationError && (
          <SessionError
            error={navigationError}
            retry={flow.data.id ? () => void select(flow.data.id!) : undefined}
          />
        )}
        {create.error && <SessionError error={create.error} />}
        {flow.data.uncertain && !flow.data.pending && (
          <section className="session-start-recovery" aria-label={t('SessionRecent')}>
            <p role="status">{t('SessionCreationUncertain')}</p>
            <div className="session-actions">
              <Button
                variant="outline"
                disabled={state.isFetching}
                onClick={async () => {
                  const result = await state.refetch();
                  setReviewed(!result.isError);
                }}
              >
                {t('LibraryRefresh')}
              </Button>
              {reviewed && (
                <Button
                  onClick={() => {
                    cache.setQueryData(['session-workspace', 'creation'], {});
                    create.reset();
                    setReviewed(false);
                  }}
                >
                  {t('SessionCreationReviewed')}
                </Button>
              )}
            </div>
            {state.isPending && <p role="status">{t('LoadingStudy')}</p>}
            {state.error && (
              <SessionReadError error={state.error} retry={() => void state.refetch()} />
            )}
            {state.isSuccess && items.length === 0 && <p>{t('SessionListEmpty')}</p>}
            <ul className="session-list">
              {items.map((item) => (
                <li key={String(item.id)}>
                  <Link to="/sessions" search={{ ...search, id: String(item.id) }}>
                    <span>{item.title || t('SessionUntitled')}</span>
                    <time>{date(item.updatedAt)}</time>
                  </Link>
                </li>
              ))}
            </ul>
            {state.hasNextPage && (
              <Button
                variant="ghost"
                disabled={state.isFetchingNextPage}
                onClick={() => void state.fetchNextPage()}
              >
                {t('LibraryMore')}
              </Button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function SessionBody({ id }: { id: SessionId }) {
  const { t } = useI18n();
  const search = useSearch({ from: '__root__' });
  const state = useQuery(sessionOptions(id));
  const cache = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const files = useAttachments(id);
  const deletion = useQuery(deletionOptions(id, true));
  const live = deletion.isError && toStudyError(deletion.error).kind === 'not_found';
  useEffect(() => {
    if (state.isSuccess) {
      const created = cache.getQueryData<{ id?: SessionId }>(['session-workspace', 'creation']);
      if (created?.id === id) cache.setQueryData(['session-workspace', 'creation'], {});
    }
  }, [cache, id, state.isSuccess]);
  return (
    <div
      className="session-canvas"
      onDragOver={(event) => {
        if (live && !deleting) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        const draft = cache.getQueryData<Draft>(['session-drafts', String(id), 'note']);
        if (
          state.data &&
          live &&
          !deleting &&
          !draft?.pending &&
          !draft?.askAttempt &&
          draft?.noteAttempt === undefined
        )
          files.add(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="session-toolbar session-canvas-toolbar">
        <Button
          variant="ghost"
          render={
            <Link to="/sessions" search={search.project ? { project: search.project } : {}} />
          }
        >
          {t('SessionBack')}
        </Button>
        {state.data && !state.isError && live && (
          <h2>{state.data.title || t('SessionUntitled')}</h2>
        )}
        <Deletion
          id={id}
          allowDelete={!!state.data && !state.isError && live}
          onDeleting={setDeleting}
        />
      </div>
      {state.isPending && <p role="status">{t('LoadingStudy')}</p>}
      {state.error && <SessionReadError error={state.error} retry={() => void state.refetch()} />}
      {state.data && !state.isError && live && (
        <>
          {!deleting && (
            <>
              <SelectionPanel id={id} />
              <History id={id} />
              <Transformation id={id} />
              <Composer id={id} />
            </>
          )}
        </>
      )}
    </div>
  );
}
function Deletion({
  id,
  allowDelete,
  onDeleting
}: {
  id: SessionId;
  allowDelete: boolean;
  onDeleting: (value: boolean) => void;
}) {
  const { t } = useI18n();
  const cache = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [started, setStarted] = useState(false);
  const state = useQuery(deletionOptions(id, true));
  const mutation = useMutation({
    mutationFn: () => deleteSession(id),
    retry: false,
    onMutate: () => {
      setStarted(true);
      onDeleting(true);
    },
    onSuccess: (value) => {
      cache.setQueryData(deletionOptions(id, true).queryKey, value);
      void cache.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (error) => {
      if (toStudyError(error).kind === 'invalid_input') {
        setStarted(false);
        onDeleting(false);
      }
      void cache.invalidateQueries({ queryKey: deletionOptions(id, true).queryKey });
    }
  });
  const retry = useMutation({
    mutationFn: () => retryDeletion(id),
    retry: false,
    onSuccess: (value) => cache.setQueryData(deletionOptions(id, true).queryKey, value)
  });
  return (
    <details
      open={confirm || !!state.data || started}
      onToggle={(event) => setConfirm(event.currentTarget.open)}
      className="session-delete"
    >
      <summary>{t('SessionDelete')}</summary>
      <p>{t('SessionDeleteHelp')}</p>
      {allowDelete && !started && !state.data && (
        <Button
          variant="destructive-outline"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {t('SessionConfirmDelete')}
        </Button>
      )}
      {mutation.error && <SessionError error={mutation.error} retry={() => mutation.mutate()} />}
      {state.error && toStudyError(state.error).kind !== 'not_found' && (
        <SessionReadError error={state.error} retry={() => void state.refetch()} />
      )}
      {state.data?.status === 'pending' && <p role="status">{t('SessionDeleting')}</p>}
      {state.data?.status === 'failed' && (
        <Button disabled={retry.isPending} onClick={() => retry.mutate()}>
          {t('SessionRetryDelete')}
        </Button>
      )}
      {retry.error && <SessionError error={retry.error} />}
      {state.data?.status === 'completed' && <p role="status">{t('SessionDeleted')}</p>}
    </details>
  );
}
