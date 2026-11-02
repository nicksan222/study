import { sessionIdSchema } from '@study/contracts/ids';
import type { SessionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { ComposerSurface } from '@study/ui/composer';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { Notebook } from '@study/ui/session-workspace';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';
import { ArrowRight, NotebookPen } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { toStudyError } from '../../lib/study-client/errors';
import { useAttachments } from './attachments';
import { Composer } from './composer';
import type { Draft } from './draft';
import { History } from './history';
import { SelectionPanel } from './selection';
import { deletionOptions, sessionOptions } from './session-workspace.queries';
import { SessionError, SessionReadError } from './status';
import { Transformation } from './transformation';
import { useSessionStart, useDeletion } from './workspace-state.queries';

export function SessionWorkspace() {
  const search = useSearch({ from: '__root__' });
  const id = search.id ? Schema.decodeUnknownSync(sessionIdSchema)(BigInt(search.id)) : undefined;

  return (
    <Notebook.Workspace>
      {id ? <SessionBody key={String(id)} id={id} /> : <SessionStart />}
    </Notebook.Workspace>
  );
}

type SessionStartModel = ReturnType<typeof useSessionStart>;

function SessionStart() {
  const model = useSessionStart();
  const { t, state, flow, draft, cache, draftKey, blocked, beginSession } = model;

  if (state.isError && !flow.data.uncertain && !flow.data.id) {
    return (
      <SessionReadError error={state.error} retry={() => void state.refetch()} layout="page" />
    );
  }

  return (
    <Notebook.Start>
      <Notebook.StartContent>
        <Notebook.StartHeading>
          <h1>{t('SessionStartTitle')}</h1>
          <p>{t('SessionStartHelp')}</p>
        </Notebook.StartHeading>
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
            <Notebook.StartKind>
              <NotebookPen size={16} aria-hidden="true" />
              {t('SessionNotebook')}
            </Notebook.StartKind>
            <Button disabled={blocked} onClick={beginSession}>
              {t('SessionNew')}
              <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </ComposerSurface.Footer>
        </ComposerSurface.Root>
        <ComposerSurface.Hint id="session-start-hint">
          {t('SessionStartDraftHelp')}
        </ComposerSurface.Hint>
        <SessionCreationStatus model={model} />
        <SessionCreationRecovery model={model} />
      </Notebook.StartContent>
    </Notebook.Start>
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
  const available = sessionAvailable(state, live);

  useEffect(() => {
    if (state.isSuccess) {
      const created = cache.getQueryData<{ id?: SessionId }>(['session-workspace', 'creation']);

      if (created?.id === id) cache.setQueryData(['session-workspace', 'creation'], {});
    }
  }, [cache, id, state.isSuccess]);

  return (
    <Notebook.Canvas
      onDragOver={(event) => {
        if (live && !deleting) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        const draft = cache.getQueryData<Draft>(['session-drafts', String(id), 'note']);

        if (available && !deleting && attachableDraft(draft))
          files.add(Array.from(event.dataTransfer.files));
      }}
    >
      <Notebook.CanvasToolbar>
        <Button
          variant="ghost"
          render={
            <Link to="/sessions" search={search.project ? { project: search.project } : {}} />
          }
        >
          {t('SessionBack')}
        </Button>
        {available && state.data && <h2>{state.data.title || t('SessionUntitled')}</h2>}
        <Deletion id={id} allowDelete={available} onDeleting={setDeleting} />
      </Notebook.CanvasToolbar>
      {state.isPending && <Loading label={t('LoadingStudy')} />}
      {state.error && <SessionReadError error={state.error} retry={() => void state.refetch()} />}
      {available && (
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
    </Notebook.Canvas>
  );
}

type DeletionModel = ReturnType<typeof useDeletion>;

function Deletion(props: Parameters<typeof useDeletion>[0]) {
  const model = useDeletion(props);
  const { t, confirm, setConfirm, state, started, mutation, allowDelete } = model;

  return (
    <Notebook.Delete
      open={confirm || !!state.data || started}
      onToggle={(event) => setConfirm(event.currentTarget.open)}
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
      <DeletionStatus model={model} />
    </Notebook.Delete>
  );
}

function SessionCreationStatus({ model }: { model: SessionStartModel }) {
  const { t, flow, navigationError, select, create } = model;

  return (
    <>
      {flow.data.pending && <Loading label={t('SessionStarting')} />}
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
    </>
  );
}

function SessionCreationRecovery({ model }: { model: SessionStartModel }) {
  const { t, date, cache, search, state, flow, reviewed, setReviewed, create, items } = model;

  return (
    <>
      {flow.data.uncertain && !flow.data.pending && (
        <Notebook.StartRecovery aria-label={t('SessionRecent')}>
          <p role="status">{t('SessionCreationUncertain')}</p>
          <Notebook.Actions>
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
          </Notebook.Actions>
          {state.isPending && <Loading label={t('LoadingStudy')} />}
          {state.error && (
            <SessionReadError error={state.error} retry={() => void state.refetch()} />
          )}
          {state.isSuccess && items.length === 0 && <p>{t('SessionListEmpty')}</p>}
          <Notebook.List>
            {items.map((item) => (
              <li key={String(item.id)}>
                <Link to="/sessions" search={{ ...search, id: String(item.id) }}>
                  <span>{item.title || t('SessionUntitled')}</span>
                  <time>{date(item.updatedAt)}</time>
                </Link>
              </li>
            ))}
          </Notebook.List>
          {state.hasNextPage && (
            <Button
              variant="ghost"
              disabled={state.isFetchingNextPage}
              onClick={() => void state.fetchNextPage()}
            >
              {t('LibraryMore')}
            </Button>
          )}
        </Notebook.StartRecovery>
      )}
    </>
  );
}

function attachableDraft(draft: Draft | undefined) {
  return !draft?.pending && !draft?.askAttempt && draft?.noteAttempt === undefined;
}

function DeletionStatus({ model }: { model: DeletionModel }) {
  const { t, mutation, state, retry } = model;

  const status = state.data?.status;

  return (
    <>
      {mutation.error && <SessionError error={mutation.error} retry={() => mutation.mutate()} />}
      {state.error && toStudyError(state.error).kind !== 'not_found' && (
        <SessionReadError error={state.error} retry={() => void state.refetch()} />
      )}
      {status === 'pending' && <Loading label={t('SessionDeleting')} />}
      {status === 'failed' && (
        <ErrorState
          title={t('workspace.state.failure')}
          action={
            <Button disabled={retry.isPending} onClick={() => retry.mutate()}>
              {t('SessionRetryDelete')}
            </Button>
          }
        />
      )}
      {retry.error && <SessionError error={retry.error} />}
      {status === 'completed' && <p role="status">{t('SessionDeleted')}</p>}
    </>
  );
}

function sessionAvailable(state: { data: unknown; isError: boolean }, live: boolean) {
  return !!state.data && !state.isError && live;
}
