import { projectIdSchema } from '@study/contracts/ids';
import type { ProjectId, SessionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { ComposerSurface } from '@study/ui/composer';
import { WorkspaceCard, WorkspaceSurface } from '@study/ui/workspace';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';
import { ArrowUp, NotebookPen, Paperclip, X } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { toStudyError } from '../../lib/study-client/errors';
import { createSession } from '../../lib/study-client/operations';
import { addAttachments } from './attachments';
import { emptyDraft } from './draft';
import type { Draft } from './draft';
import { sessionPagesOptions } from './session-workspace.queries';
import { SessionError, SessionReadError } from './status';
import { WorkspaceContext } from './workspace-context';
import { WorkspaceFooter } from './workspace-footer';

export function SessionStart() {
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
  const filesKey = [...draftKey, 'files'];
  const files = useQuery({
    queryKey: filesKey,
    queryFn: () => [] as File[],
    initialData: [] as File[],
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
    mutationFn: (input: { project?: ProjectId; draftKey: string[]; filesKey: string[] }) =>
      createSession(input.project),
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
    const current = cache.getQueryData<{ id?: SessionId; uncertain?: boolean; pending?: boolean }>([
      'session-workspace',
      'creation'
    ]);
    if (current?.id || current?.uncertain || current?.pending) return;
    cache.setQueryData(['session-workspace', 'creation'], { uncertain: true, pending: true });
    create.mutate({ project, draftKey, filesKey });
  }
  const items = state.data?.pages.flatMap((page) => page.items) ?? [];
  const blocked = create.isPending || !!flow.data.id || !!flow.data.uncertain;
  if (state.isError && !flow.data.uncertain && !flow.data.id) {
    return (
      <SessionReadError error={state.error} retry={() => void state.refetch()} layout="page" />
    );
  }
  return (
    <WorkspaceSurface.Root variant="welcome" className="session-start">
      <WorkspaceSurface.Controls>
        <WorkspaceCard.Toggle label={t('SessionContextPanel')} />
      </WorkspaceSurface.Controls>
      <WorkspaceContext />
      <WorkspaceSurface.Heading>
        <h1>{t('SessionStartTitle')}</h1>
        <p>{t('SessionStartHelp')}</p>
      </WorkspaceSurface.Heading>
      <WorkspaceSurface.Dock>
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
            <ul className="session-start-files">
              {files.data.map((file, index) => (
                <li key={index}>
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
            </ul>
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
            <label
              className="session-file-button session-start-attach"
              title={t('SessionAttachFiles')}
            >
              <Paperclip size={18} aria-hidden="true" />
              <input
                type="file"
                aria-label={t('SessionAttachFiles')}
                multiple
                disabled={blocked}
                onChange={(event) => {
                  const added = Array.from(event.target.files ?? []);
                  cache.setQueryData<File[]>(filesKey, (previous) => [
                    ...(previous ?? []),
                    ...added
                  ]);
                  event.target.value = '';
                }}
              />
            </label>
            <span className="session-start-kind">
              <NotebookPen size={18} aria-hidden="true" />
              {t('SessionNotebook')}
            </span>
            <Button
              className="ui-composer-submit"
              size="icon"
              aria-label={t('SessionNew')}
              title={t('SessionNew')}
              disabled={blocked}
              onClick={beginSession}
            >
              <ArrowUp size={20} aria-hidden="true" />
            </Button>
          </ComposerSurface.Footer>
        </ComposerSurface.Root>
        <WorkspaceFooter />
        <ComposerSurface.Hint id="session-start-hint" className="sr-only">
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
      </WorkspaceSurface.Dock>
    </WorkspaceSurface.Root>
  );
}
