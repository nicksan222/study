import { projectIdSchema } from '@study/contracts/ids';
import type { SessionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { ComposerSurface } from '@study/ui/composer';
import { Loading } from '@study/ui/loading';
import { SessionStarter } from '@study/ui/session-start';
import { WorkspaceCard, WorkspaceSurface } from '@study/ui/workspace';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';
import { ArrowUp, NotebookPen, Paperclip, X } from 'lucide-react';
import { useId, useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { toStudyError } from '../../lib/study-client/errors';
import { addAttachments } from './attachments';
import { emptyDraft } from './draft';
import type { Draft } from './draft';
import { sessionPagesOptions } from './session-workspace.queries';
import {
  startDraftOptions,
  startFilesOptions,
  creationFlowOptions,
  startSessionMutation
} from './start.queries';
import type { CreationFlow } from './start.queries';
import { SessionError, SessionReadError } from './status';
import { WorkspaceContext } from './workspace-context';
import { WorkspaceFooter } from './workspace-footer';

/** Draft text and attachments remain cached under their originating project scope. */
function useStartDraft(project: string | undefined) {
  const draftKey = ['session-start-draft', project ?? 'all'];
  const draft = useQuery(startDraftOptions(draftKey));
  const filesKey = [...draftKey, 'files'];
  const files = useQuery(startFilesOptions(filesKey));

  return { draftKey, draft, filesKey, files };
}

/** Creation owns the shared uncertainty fence and transfers only the submitted draft keys. */
function useSessionStart() {
  const cache = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ from: '__root__' });
  const project = search.project
    ? Schema.decodeUnknownSync(projectIdSchema)(BigInt(search.project))
    : undefined;
  const state = useInfiniteQuery(sessionPagesOptions(project));
  const { draftKey, draft, filesKey, files } = useStartDraft(search.project);
  const flow = useQuery(creationFlowOptions());
  const [navigationError, setNavigationError] = useState<unknown>();
  const [reviewed, setReviewed] = useState(false);

  async function select(id: SessionId) {
    try {
      await navigate({
        to: '/sessions/$sessionId',
        params: { sessionId: id },
        search: search.project ? { project: search.project } : {}
      });
      setNavigationError(undefined);
    } catch (error) {
      setNavigationError(error);
    }
  }

  const create = useMutation({
    ...startSessionMutation,
    onMutate: () => {
      cache.setQueryData(['session-workspace', 'creation'], { uncertain: true, pending: true });
      setReviewed(false);
    },
    onError: (error) => {
      if (toStudyError(error).kind === 'invalid_input')
        cache.setQueryData(['session-workspace', 'creation'], {});
    },
    onSettled: () => {
      cache.setQueryData<CreationFlow>(['session-workspace', 'creation'], (previous) => ({
        ...previous,
        pending: false
      }));
    },
    onSuccess: (created, input) => {
      const text = cache.getQueryData<string>(input.draftKey) ?? '';

      cache.setQueryData<Draft>(['session-drafts', String(created.id), 'note'], {
        ...emptyDraft,
        text
      });
      addAttachments(cache, created.id, cache.getQueryData<File[]>(input.filesKey) ?? []);
      cache.setQueryData(input.filesKey, []);
      cache.setQueryData(input.draftKey, '');
      cache.setQueryData(['session-workspace', 'creation'], { id: created.id });
      void cache.invalidateQueries({ queryKey: ['sessions'] });
      void select(created.id);
    }
  });

  function beginSession() {
    const current = cache.getQueryData<CreationFlow>(['session-workspace', 'creation']);

    if (current?.id || current?.uncertain || current?.pending) return;

    cache.setQueryData(['session-workspace', 'creation'], { uncertain: true, pending: true });
    create.mutate({ project, draftKey, filesKey });
  }

  const blocked = create.isPending || !!flow.data.id || !!flow.data.uncertain;

  return {
    cache,
    search,
    state,
    draftKey,
    draft,
    filesKey,
    files,
    flow,
    navigationError,
    reviewed,
    setReviewed,
    create,
    beginSession,
    select,
    blocked
  };
}

type StartView = ReturnType<typeof useSessionStart>;

/** Presents session creation with quick notes, attachments and recoverable submission state. */
export function SessionStart() {
  const { t } = useI18n();
  const view = useSessionStart();
  const { state, flow } = view;

  if (state.isError && !flow.data.uncertain && !flow.data.id) {
    return (
      <SessionReadError error={state.error} retry={() => void state.refetch()} layout="page" />
    );
  }

  return (
    <SessionStarter.Root>
      <WorkspaceSurface.Controls>
        <WorkspaceCard.Toggle label={t('SessionContextPanel')} />
      </WorkspaceSurface.Controls>
      <WorkspaceContext />
      <WorkspaceSurface.Heading>
        <h1>{t('SessionStartTitle')}</h1>
        <p>{t('SessionStartHelp')}</p>
      </WorkspaceSurface.Heading>
      <WorkspaceSurface.Dock>
        <StarterComposer view={view} />
        <WorkspaceFooter />
        <SessionStarter.Hint id="session-start-hint">
          {t('SessionStartDraftHelp')}
        </SessionStarter.Hint>
        <CreationStatus view={view} />
        <CreationRecovery view={view} />
      </WorkspaceSurface.Dock>
    </SessionStarter.Root>
  );
}

const attachmentIds = new WeakMap<File, string>();

/** File identity survives removals; occurrence suffixes also support repeated File references. */
function attachmentEntries(files: File[]) {
  const occurrences = new Map<string, number>();

  return files.map((file, index) => {
    let id = attachmentIds.get(file);

    if (!id) {
      id = crypto.randomUUID();
      attachmentIds.set(file, id);
    }

    const occurrence = occurrences.get(id) ?? 0;

    occurrences.set(id, occurrence + 1);

    return { file, index, key: `${id}:${occurrence}` };
  });
}

/** Starter editing uses the same project draft and blocks attachments once creation starts. */
function StarterComposer({ view }: { view: StartView }) {
  const { t } = useI18n();
  const attachmentId = useId();
  const { cache, filesKey, files, draftKey, draft, blocked, beginSession } = view;

  return (
    <ComposerSurface.Root
      variant="starter"
      aria-label={t('SessionCompose')}
      onDragOver={(event) => {
        if (!blocked) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();

        if (!blocked) {
          const added = Array.from(event.dataTransfer.files);

          cache.setQueryData<File[]>(filesKey, (previous) => [...(previous ?? []), ...added]);
        }
      }}
    >
      {files.data.length > 0 && (
        <SessionStarter.Files>
          {attachmentEntries(files.data).map(({ file, index, key }) => (
            <li key={key}>
              <Paperclip size={14} aria-hidden="true" />
              <span>{file.name}</span>
              <Button
                size="icon-sm"
                variant="ghost-muted"
                aria-label={t('SessionRemoveAttachment')}
                disabled={blocked}
                onClick={() =>
                  cache.setQueryData(
                    filesKey,
                    files.data.filter((_, i) => i !== index)
                  )
                }
              >
                <X size={14} aria-hidden="true" />
              </Button>
            </li>
          ))}
        </SessionStarter.Files>
      )}
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
        <SessionStarter.Attachment htmlFor={attachmentId} title={t('SessionAttachFiles')}>
          <Paperclip size={18} aria-hidden="true" />
          <input
            id={attachmentId}
            type="file"
            aria-label={t('SessionAttachFiles')}
            multiple
            disabled={blocked}
            onChange={(event) => {
              const added = Array.from(event.target.files ?? []);

              cache.setQueryData<File[]>(filesKey, (previous) => [...(previous ?? []), ...added]);
              event.target.value = '';
            }}
          />
        </SessionStarter.Attachment>
        <SessionStarter.Kind>
          <NotebookPen size={18} aria-hidden="true" />
          {t('SessionNotebook')}
        </SessionStarter.Kind>
        <SessionStarter.Submit
          size="icon"
          aria-label={t('SessionNew')}
          title={t('SessionNew')}
          disabled={blocked}
          onClick={beginSession}
        >
          <ArrowUp size={20} aria-hidden="true" />
        </SessionStarter.Submit>
      </ComposerSurface.Footer>
    </ComposerSurface.Root>
  );
}

/** Navigation failures retain the known created session for a safe retry. */
function CreationStatus({ view }: { view: StartView }) {
  const { t } = useI18n();
  const { flow, select, navigationError, create } = view;

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

/** An uncertain creation can be cleared only after a successful session-list review. */
function CreationRecovery({ view }: { view: StartView }) {
  const { t, date } = useI18n();
  const { flow, state, reviewed, setReviewed, cache, create, search } = view;
  const items = state.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      {flow.data.uncertain && !flow.data.pending && (
        <SessionStarter.Recovery aria-label={t('SessionRecent')}>
          <p role="status">{t('SessionCreationUncertain')}</p>
          <SessionStarter.Actions>
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
          </SessionStarter.Actions>
          {state.isPending && <Loading label={t('LoadingStudy')} />}
          {state.error && (
            <SessionReadError error={state.error} retry={() => void state.refetch()} />
          )}
          {state.isSuccess && items.length === 0 && <p>{t('SessionListEmpty')}</p>}
          <SessionStarter.Sessions>
            {items.map((item) => (
              <li key={String(item.id)}>
                <Link
                  to="/sessions/$sessionId"
                  params={{ sessionId: item.id }}
                  search={search.project ? { project: search.project } : {}}
                >
                  <span>{item.title || t('SessionUntitled')}</span>
                  <time>{date(item.updatedAt)}</time>
                </Link>
              </li>
            ))}
          </SessionStarter.Sessions>
          {state.hasNextPage && (
            <Button
              variant="ghost"
              disabled={state.isFetchingNextPage}
              onClick={() => void state.fetchNextPage()}
            >
              {t('LibraryMore')}
            </Button>
          )}
        </SessionStarter.Recovery>
      )}
    </>
  );
}
